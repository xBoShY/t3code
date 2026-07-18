import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { it, assert, vi } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ProviderAdapterRegistry from "../Services/ProviderAdapterRegistry.ts";
import * as ProviderInstanceRegistry from "../Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../ProviderDriver.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import type * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as ProviderAdapterRegistryLayer from "./ProviderAdapterRegistry.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const PI_DRIVER = ProviderDriverKind.make("pi");

const makeFakeAdapter = (provider: ProviderDriverKind): ProviderInstance["adapter"] => ({
  provider,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
});

const fakePiAdapter = makeFakeAdapter(PI_DRIVER);

// ProviderAdapterRegistryLive is now a facade over ProviderInstanceRegistry —
// it walks `listInstances` once at boot and surfaces the default-instance
// adapter keyed by its driver kind. To test the facade we supply a fake
// instance whose `instanceId === defaultInstanceIdForDriver(driverKind)` so
// it passes the default-instance filter.
const makeFakeInstance = (
  driverKind: ProviderDriverKind,
  adapter: ProviderInstance["adapter"],
): ProviderInstance => ({
  instanceId: defaultInstanceIdForDriver(driverKind),
  driverKind,
  continuationIdentity: {
    driverKind,
    continuationKey: `${driverKind}:instance:${defaultInstanceIdForDriver(driverKind)}`,
  },
  displayName: undefined,
  enabled: true,
  snapshot: {
    maintenanceCapabilities: makeManualOnlyProviderMaintenanceCapabilities({
      provider: driverKind,
      packageName: null,
    }),
    getSnapshot: Effect.succeed({} as unknown as ServerProvider),
    refresh: Effect.succeed({} as unknown as ServerProvider),
    streamChanges: Stream.empty,
  },
  adapter,
  textGeneration: {} as unknown as TextGeneration.TextGeneration["Service"],
});

const fakeInstances: ReadonlyArray<ProviderInstance> = [makeFakeInstance(PI_DRIVER, fakePiAdapter)];

const fakeInstanceRegistryLayer = Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
  getInstance: (instanceId) =>
    Effect.succeed(fakeInstances.find((instance) => instance.instanceId === instanceId)),
  listInstances: Effect.succeed(fakeInstances),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  // Tests never drive changes through this fake; acquire a throwaway
  // subscription on an unused PubSub so the shape is satisfied.
  subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) => PubSub.subscribe(pubsub)),
});

const layer = Layer.mergeAll(
  Layer.provide(
    ProviderAdapterRegistryLayer.ProviderAdapterRegistryLive,
    fakeInstanceRegistryLayer,
  ),
  NodeServices.layer,
);

it.layer(layer)("ProviderAdapterRegistryLive", (it) => {
  it("resolves adapters and routing metadata from provider instances", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry.ProviderAdapterRegistry;
      const piInstanceId = defaultInstanceIdForDriver(PI_DRIVER);

      const adapter = yield* registry.getByInstance(piInstanceId);
      assert.strictEqual(adapter, fakePiAdapter);

      const info = yield* registry.getInstanceInfo(piInstanceId);
      assert.deepStrictEqual(info, {
        instanceId: piInstanceId,
        driverKind: PI_DRIVER,
        displayName: undefined,
        accentColor: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: PI_DRIVER,
          continuationKey: "pi:instance:pi",
        },
      });

      const instances = yield* registry.listInstances();
      assert.deepStrictEqual(instances, [piInstanceId]);

      const providers = yield* registry.listProviders();
      assert.deepStrictEqual(providers, [PI_DRIVER]);
    }));
});
