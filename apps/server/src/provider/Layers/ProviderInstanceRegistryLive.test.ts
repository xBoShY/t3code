/**
 * Multi-instance validation slices for `ProviderInstanceRegistryLive`.
 *
 * Two axes of the driver/registry refactor are exercised here:
 *
 *  1. **Same driver, many instances** — the "multi-instance pi slice"
 *     describe block below configures two independent `pi` instances and
 *     asserts each gets its own closures and identity. This is the
 *     multi-instance capability the refactor exists to unlock.
 *
 *  2. **Registered vs shadowed** — the shadow test configures one registered
 *     `pi` instance alongside an instance whose driver this build does not
 *     ship, and asserts the registry boots the known driver while downgrading
 *     the unknown one to an "unavailable" shadow snapshot without failing
 *     boot. This proves the driver SPI degrades gracefully across forks.
 *
 * Every instance in these tests is configured with `enabled: false` so the
 * provider-status checks short-circuit to pending/disabled snapshots without
 * trying to spawn a real `pi` binary. That keeps the assertions focused on
 * registry routing behaviour rather than the runtime details of the provider.
 */
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type PiSettings,
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { PiDriver } from "../Drivers/PiDriver.ts";
import { PiRuntimeLive } from "../piRuntime.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "./ProviderEventLoggers.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
  ),
);

const makePiConfig = (overrides: Partial<PiSettings>): PiSettings => ({
  enabled: false,
  binaryPath: "pi",
  customModels: [],
  ...overrides,
});

describe("ProviderInstanceRegistryLive — multi-instance pi slice", () => {
  // All drivers need `NodeServices` (ChildProcessSpawner + FileSystem +
  // Path). `PiDriver.create` additionally yields its own runtime service at
  // construction time, so we wire `PiRuntimeLive` into the stack. It bundles
  // its own `NetService.layer` via `Layer.provide`, so the only external
  // requirement it still exposes is `ChildProcessSpawner` — resolved here by
  // piping the merged layer through `provideMerge(NodeServices.layer)`.
  const infraLayer = Layer.mergeAll(PiRuntimeLive).pipe(Layer.provideMerge(NodeServices.layer));
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "provider-instance-registry-test",
  }).pipe(
    Layer.provideMerge(infraLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(TestHttpClientLive),
    Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  );

  it.live("boots two independent pi instances from a ProviderInstanceConfigMap", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("pi_personal");
      const workId = ProviderInstanceId.make("pi_work");
      const piDriverKind = ProviderDriverKind.make("pi");

      const configMap: ProviderInstanceConfigMap = {
        [personalId]: {
          driver: piDriverKind,
          displayName: "Pi (personal)",
          enabled: false,
          config: makePiConfig({
            binaryPath: "/opt/pi-personal/bin/pi",
            customModels: ["personal-preview"],
          }),
        },
        [workId]: {
          driver: piDriverKind,
          displayName: "Pi (work)",
          enabled: false,
          config: makePiConfig({
            binaryPath: "/opt/pi-work/bin/pi",
            customModels: ["work-preview"],
          }),
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [PiDriver],
        configMap,
      });

      const instances = yield* registry.listInstances;
      expect(instances.map((instance) => instance.instanceId).toSorted()).toEqual(
        [personalId, workId].toSorted(),
      );
      expect(instances.every((instance) => instance.driverKind === piDriverKind)).toBe(true);
      expect(instances.map((instance) => instance.displayName).toSorted()).toEqual(
        ["Pi (personal)", "Pi (work)"].toSorted(),
      );

      // Each instance must be retrievable by id and carry its *own* closures.
      const personal = yield* registry.getInstance(personalId);
      const work = yield* registry.getInstance(workId);
      expect(personal).toBeDefined();
      expect(work).toBeDefined();
      expect(personal!.adapter).not.toBe(work!.adapter);
      expect(personal!.textGeneration).not.toBe(work!.textGeneration);
      expect(personal!.snapshot).not.toBe(work!.snapshot);

      // Snapshots identify themselves by instanceId + driver — this is
      // what makes per-instance routing distinguishable downstream.
      const personalSnapshot = yield* personal!.snapshot.getSnapshot;
      expect(personalSnapshot.instanceId).toBe(personalId);
      expect(personalSnapshot.driver).toBe(piDriverKind);
      expect(personalSnapshot.enabled).toBe(false);
      expect(personalSnapshot.continuation?.groupKey).toBe(
        `${piDriverKind}:instance:${personalId}`,
      );

      const workSnapshot = yield* work!.snapshot.getSnapshot;
      expect(workSnapshot.instanceId).toBe(workId);
      expect(workSnapshot.driver).toBe(piDriverKind);
      expect(workSnapshot.enabled).toBe(false);
      expect(workSnapshot.continuation?.groupKey).toBe(`${piDriverKind}:instance:${workId}`);

      // Nothing goes to the unavailable bucket — the driver is registered.
      const unavailable = yield* registry.listUnavailable;
      expect(unavailable).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live(
    "shadows instances whose driver is not registered in this build without failing boot",
    () =>
      Effect.gen(function* () {
        const piId = ProviderInstanceId.make("pi_main");
        const ghostId = ProviderInstanceId.make("ghost_main");

        const configMap: ProviderInstanceConfigMap = {
          [piId]: {
            driver: ProviderDriverKind.make("pi"),
            enabled: false,
            config: makePiConfig({}),
          },
          [ghostId]: {
            driver: ProviderDriverKind.make("ghostDriver"),
            displayName: "A fork-only driver we don't ship",
            enabled: false,
            config: { arbitrary: "payload", preserved: true },
          },
        };

        const { registry } = yield* makeProviderInstanceRegistry({
          drivers: [PiDriver],
          configMap,
        });

        const instances = yield* registry.listInstances;
        expect(instances).toHaveLength(1);
        expect(instances[0]!.instanceId).toBe(piId);

        const unavailable = yield* registry.listUnavailable;
        expect(unavailable).toHaveLength(1);
        const ghost = unavailable[0]!;
        expect(ghost.instanceId).toBe(ghostId);
        expect(ghost.driver).toBe("ghostDriver");
        expect(ghost.availability).toBe("unavailable");
        expect(ghost.unavailableReason).toMatch(/ghostDriver/);
      }).pipe(Effect.provide(testLayer)),
  );
});
