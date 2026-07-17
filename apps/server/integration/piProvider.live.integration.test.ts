// Live end-to-end coverage for the Pi provider. Skipped by default; runs only
// when PI_LIVE_TEST=1 and pi is authenticated (`pi` on PATH with a provider
// configured in ~/.pi/agent/auth.json — run `pi` and `/login` once). It spawns
// a real `pi --mode rpc` and calls a real model, so it is not part of CI.
//
//   PI_LIVE_TEST=1 corepack pnpm --filter t3 test piProvider.live
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../src/config.ts";
import { makePiAdapter } from "../src/provider/Layers/PiAdapter.ts";
import { PiRuntimeLive } from "../src/provider/piRuntime.ts";

interface EventView {
  readonly type: string;
  readonly requestId?: string;
  readonly payload?: {
    readonly itemType?: string;
    readonly detail?: string;
    readonly decision?: string;
    readonly state?: string;
  };
}

const settings = Schema.decodeSync(PiSettings)({ binaryPath: "pi", enabled: true });
const MODEL = "anthropic/claude-haiku-4-5";
const cwd = process.cwd();

const LiveLayer = PiRuntimeLive.pipe(
  Layer.provideMerge(ServerConfig.layerTest(cwd, cwd)),
  Layer.provideMerge(NodeServices.layer),
);

const isTerminal = (event: { type: string }) =>
  event.type === "turn.completed" || event.type === "turn.aborted";

it.live.skipIf(process.env.PI_LIVE_TEST !== "1")(
  "reaches a real model and completes a plain turn",
  () =>
    Effect.gen(function* () {
      const adapter = yield* makePiAdapter(settings);
      const threadId = ThreadId.make("pi-live-plain");

      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.takeUntil(isTerminal),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("pi"),
        threadId,
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "Reply with exactly this text and nothing else: PI_OK",
        modelSelection: createModelSelection(ProviderInstanceId.make("pi"), MODEL, []),
      });

      const events = (Array.from(yield* Fiber.join(eventsFiber)) as ReadonlyArray<unknown>).map(
        (event) => event as EventView,
      );
      yield* adapter.stopSession(threadId).pipe(Effect.ignore);

      assert.equal(events.at(-1)?.type, "turn.completed");
      assert.equal(events.at(-1)?.payload?.state, "completed");
      const assistant = events.find(
        (event) =>
          event.type === "item.completed" && event.payload?.itemType === "assistant_message",
      );
      assert.isDefined(assistant, "expected an assistant_message item");
      assert.include(String(assistant?.payload?.detail ?? ""), "PI_OK");
    }).pipe(Effect.scoped, Effect.provide(LiveLayer)),
  120_000,
);

it.live.skipIf(process.env.PI_LIVE_TEST !== "1")(
  "gates a real bash tool call through the approval extension",
  () =>
    Effect.gen(function* () {
      const adapter = yield* makePiAdapter(settings);
      const threadId = ThreadId.make("pi-live-tool");

      // Auto-accept whatever approval the injected pi extension raises.
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.threadId === threadId),
        Stream.tap((event) => {
          const view = event as EventView;
          return view.type === "request.opened" && view.requestId
            ? adapter
                .respondToRequest(
                  threadId,
                  ApprovalRequestId.make(String(view.requestId)),
                  "accept",
                )
                .pipe(Effect.ignore)
            : Effect.void;
        }),
        Stream.takeUntil(isTerminal),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* adapter.startSession({
        provider: ProviderDriverKind.make("pi"),
        threadId,
        runtimeMode: "approval-required",
      });
      yield* adapter.sendTurn({
        threadId,
        input:
          "Use your bash tool to run exactly: echo PI_TOOL_OK — then reply with the command's exact stdout.",
        modelSelection: createModelSelection(ProviderInstanceId.make("pi"), MODEL, []),
      });

      const events = (Array.from(yield* Fiber.join(eventsFiber)) as ReadonlyArray<unknown>).map(
        (event) => event as EventView,
      );
      yield* adapter.stopSession(threadId).pipe(Effect.ignore);

      assert.isDefined(
        events.find((event) => event.type === "request.opened"),
        "approval extension should raise request.opened",
      );
      assert.isDefined(
        events.find(
          (event) => event.type === "request.resolved" && event.payload?.decision === "accept",
        ),
        "approval should resolve as accept",
      );
      const toolDone = events.find(
        (event) =>
          event.type === "item.completed" && event.payload?.itemType === "command_execution",
      );
      assert.isDefined(toolDone, "expected a completed command_execution item");
      assert.include(String(toolDone?.payload?.detail ?? ""), "PI_TOOL_OK");
      assert.equal(events.at(-1)?.type, "turn.completed");
    }).pipe(Effect.scoped, Effect.provide(LiveLayer)),
  120_000,
);
