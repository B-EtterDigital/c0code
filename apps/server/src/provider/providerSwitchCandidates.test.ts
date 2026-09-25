import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { makeProviderSwitchCandidates } from "./providerSwitchCandidates.ts";

const driver = ProviderDriverKind.make("codex");
const threadId = ThreadId.make("thread");
const current = ProviderInstanceId.make("deleted-poly");
function provider(id: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver,
    displayName: id,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-25T00:00:00Z",
    models: [],
    skills: [],
    slashCommands: [],
    continuation: { groupKey: "shared-store" },
    ...overrides,
  };
}

it.effect("uses the persisted account identity and includes authenticated disabled accounts", () =>
  Effect.gen(function* () {
    const lookedUp: string[] = [];
    const discover = yield* makeProviderSwitchCandidates({
      directory: {
        getBinding: () =>
          Effect.succeed(
            Option.some({
              threadId,
              provider: driver,
              providerInstanceId: current,
              continuationKey: "shared-store",
            }),
          ),
      },
      service: {
        getInstanceInfo: (id, thread) => {
          lookedUp.push(`${id}:${thread}`);
          return Effect.succeed({
            instanceId: id,
            driverKind: driver,
            displayName: undefined,
            enabled: false,
            continuationIdentity: { driverKind: driver, continuationKey: "shared-store" },
          });
        },
      },
      registry: {
        refresh: () => Effect.succeed([]),
        getProviders: Effect.succeed([
          provider("better"),
          provider("dagga", { enabled: false, status: "disabled" }),
          provider("signed-out", { auth: { status: "unauthenticated" } }),
          provider("other-store", { continuation: { groupKey: "different" } }),
          provider("other-driver", { driver: ProviderDriverKind.make("claudeAgent") }),
        ]),
      },
    });
    const candidates = yield* discover({
      threadId,
      instanceId: ProviderInstanceId.make("selected-account"),
    });
    expect(lookedUp).toEqual(["deleted-poly:thread"]);
    expect(
      candidates.map((candidate) => [
        candidate.instanceId,
        candidate.keepsConversation,
        candidate.enabled,
      ]),
    ).toEqual([
      ["better", true, true],
      ["dagga", true, false],
      ["other-driver", false, true],
      ["other-store", false, true],
    ]);
  }),
);

it.effect("coalesces simultaneous refreshes for one minute but reads newer runtime quotas", () =>
  Effect.gen(function* () {
    let refreshes = 0;
    let used = 10;
    const discover = yield* makeProviderSwitchCandidates({
      directory: { getBinding: () => Effect.succeed(Option.none()) },
      service: {
        getInstanceInfo: (id) =>
          Effect.succeed({
            instanceId: id,
            driverKind: driver,
            displayName: undefined,
            enabled: true,
            continuationIdentity: { driverKind: driver, continuationKey: "shared-store" },
          }),
      },
      registry: {
        refresh: () =>
          Effect.sync(() => {
            refreshes++;
            return [];
          }),
        getProviders: Effect.sync(() => [
          provider("better", {
            usageLimits: {
              checkedAt: "2026-09-25T00:00:00Z",
              windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: used }],
            },
          }),
        ]),
      },
    });
    const input = { threadId, instanceId: current };
    yield* Effect.all([discover(input), discover(input)], { concurrency: "unbounded" });
    expect(refreshes).toBe(1);
    used = 100;
    expect((yield* discover(input))[0]?.usageLimits?.windows[0]?.usedPercent).toBe(100);
    yield* TestClock.adjust("61 seconds");
    yield* discover(input);
    expect(refreshes).toBe(2);
  }),
);
