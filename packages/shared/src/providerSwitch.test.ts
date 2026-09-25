import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSwitchCandidate,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  automaticSwitchCandidate,
  isQuotaExhausted,
  quotaRemaining,
  rankProviderSwitchCandidates,
} from "./providerSwitch.ts";

const now = Date.parse("2026-09-25T12:00:00Z");
function candidate(
  id: string,
  used: number,
  extra: Partial<ProviderSwitchCandidate> = {},
): ProviderSwitchCandidate {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    displayName: id,
    enabled: true,
    keepsConversation: true,
    usageLimits: {
      checkedAt: new Date(now).toISOString(),
      windows: [
        {
          id: "weekly",
          kind: "weekly",
          label: "Weekly",
          usedPercent: used,
          resetsAt: "2026-09-30T12:00:00Z",
        },
      ],
    },
    ...extra,
  };
}
describe("account switch selection", () => {
  it("ranks compatible stores first, then remaining capacity without mutating input", () => {
    const accounts = [
      candidate("new-store", 0, { keepsConversation: false }),
      candidate("full", 100),
      candidate("better", 10),
    ];
    expect(rankProviderSwitchCandidates(accounts, now).map((a) => a.instanceId)).toEqual([
      "better",
      "full",
      "new-store",
    ]);
    expect(accounts[0]?.instanceId).toBe("new-store");
  });
  it("breaks quota ties by the next reset", () => {
    const later = candidate("a", 10);
    const sooner = candidate("b", 10, {
      usageLimits: {
        checkedAt: new Date(now).toISOString(),
        windows: [
          {
            id: "weekly",
            kind: "weekly",
            label: "Weekly",
            usedPercent: 10,
            resetsAt: "2026-09-26T12:00:00Z",
          },
        ],
      },
    });
    expect(rankProviderSwitchCandidates([later, sooner], now)[0]).toBe(sooner);
  });
  it("does not auto-switch to a disabled, incompatible, exhausted, or unknown account", () => {
    const accounts = [
      candidate("disabled", 0, { enabled: false }),
      candidate("incompatible", 0, { keepsConversation: false }),
      candidate("full", 100),
      candidate("unknown", 0, {
        usageLimits: { checkedAt: new Date(now).toISOString(), windows: [] },
      }),
    ];
    expect(automaticSwitchCandidate(accounts, now)).toBeUndefined();
    const usable = candidate("usable", 90);
    expect(automaticSwitchCandidate([...accounts, usable], now)).toBe(usable);
  });
  it("uses the most constrained window and respects explicit denial", () => {
    const limits = candidate("a", 10).usageLimits!;
    expect(
      quotaRemaining(
        {
          ...limits,
          windows: [
            ...limits.windows,
            { id: "session", kind: "session", label: "Session", usedPercent: 100 },
          ],
        },
        now,
      ),
    ).toBe(0);
    expect(isQuotaExhausted({ ...limits, ordinaryUsageAllowed: false }, now)).toBe(true);
  });
  it("does not infer quota renewal from an expired reset or a failed probe", () => {
    const limits = candidate("a", 100).usageLimits!;
    expect(quotaRemaining(limits, Date.parse("2026-10-01T00:00:00Z"))).toBeNull();
    expect(quotaRemaining({ ...limits, unavailable: { reason: "probeFailed" } }, now)).toBeNull();
  });
  it("blocks a known exhausted window until reset even when the last probe is stale", () => {
    const limits = candidate("a", 100).usageLimits!;
    const later = now + 10 * 60_000;
    expect(quotaRemaining(limits, later)).toBeNull();
    expect(isQuotaExhausted(limits, later)).toBe(true);
    expect(isQuotaExhausted(limits, Date.parse("2026-10-01T00:00:00Z"))).toBe(false);
  });
});
