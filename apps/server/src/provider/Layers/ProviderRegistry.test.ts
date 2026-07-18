import { describe, it, assert } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";

import {
  haveProvidersChanged,
  mergeProviderSnapshot,
  mergeProviderSnapshots,
  selectProvidersByKind,
} from "./ProviderRegistry.ts";

const PI_DRIVER = ProviderDriverKind.make("pi");

function selectDescriptor(
  id: string,
  label: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
) {
  return {
    id,
    label,
    type: "select" as const,
    options: [...options],
    ...(options.find((option) => option.isDefault)?.id
      ? { currentValue: options.find((option) => option.isDefault)?.id }
      : {}),
  };
}

function booleanDescriptor(id: string, label: string) {
  return {
    id,
    label,
    type: "boolean" as const,
  };
}

const makePiProvider = (overrides: Partial<ServerProvider> = {}): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make("pi"),
    driver: PI_DRIVER,
    status: "ready",
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    checkedAt: "2026-04-14T00:00:00.000Z",
    version: "1.0.0",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  }) as ServerProvider;

describe("ProviderRegistry pure helpers", () => {
  it("treats equal provider snapshots as unchanged", () => {
    const providers = [makePiProvider()] as const satisfies ReadonlyArray<ServerProvider>;
    assert.strictEqual(haveProvidersChanged(providers, [...providers]), false);
  });

  it("detects changed provider snapshots", () => {
    const previous = [makePiProvider()];
    const next = [makePiProvider({ status: "warning" })];
    assert.strictEqual(haveProvidersChanged(previous, next), true);
  });

  it("preserves previously discovered provider models when a refresh returns none", () => {
    const previousProvider = makePiProvider({
      models: [
        {
          slug: "anthropic/claude-sonnet-5",
          name: "Sonnet 5",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoning", "Reasoning", [
                { id: "high", label: "High", isDefault: true },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ],
    });
    const refreshedProvider = makePiProvider({
      checkedAt: "2026-04-14T00:01:00.000Z",
      models: [],
    });

    assert.deepStrictEqual(mergeProviderSnapshot(previousProvider, refreshedProvider).models, [
      ...previousProvider.models,
    ]);
  });

  it("fills missing capabilities from the previous provider snapshot", () => {
    const previousProvider = makePiProvider({
      models: [
        {
          slug: "anthropic/claude-sonnet-5",
          name: "Sonnet 5",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              selectDescriptor("reasoning", "Reasoning", [
                { id: "high", label: "High", isDefault: true },
              ]),
              booleanDescriptor("fastMode", "Fast Mode"),
            ],
          }),
        },
      ],
    });
    const refreshedProvider = makePiProvider({
      checkedAt: "2026-04-14T00:01:00.000Z",
      models: [
        {
          slug: "anthropic/claude-sonnet-5",
          name: "Sonnet 5",
          isCustom: false,
          capabilities: createModelCapabilities({ optionDescriptors: [] }),
        },
      ],
    });

    assert.deepStrictEqual(mergeProviderSnapshot(previousProvider, refreshedProvider).models, [
      ...previousProvider.models,
    ]);
  });

  it("merges and selects snapshots by driver kind", () => {
    const previousProviders = [
      makePiProvider({
        models: [
          {
            slug: "anthropic/claude-sonnet-5",
            name: "Sonnet 5",
            isCustom: false,
            capabilities: createModelCapabilities({ optionDescriptors: [] }),
          },
        ],
      }),
    ];
    const refreshed = makePiProvider({
      checkedAt: "2026-04-14T00:01:00.000Z",
      models: [],
    });

    const mergedProviders = mergeProviderSnapshots(previousProviders, [refreshed]);
    const persistedProviders = selectProvidersByKind(mergedProviders, new Set([PI_DRIVER]));

    assert.deepStrictEqual(persistedProviders, [
      {
        ...refreshed,
        models: [...previousProviders[0]!.models],
      },
    ]);
  });
});
