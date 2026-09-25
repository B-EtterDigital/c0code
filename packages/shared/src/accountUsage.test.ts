import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, type ProviderUsageSample } from "@t3tools/contracts";
import { accountWindowTrend } from "./accountUsage.ts";
const now = Date.parse("2026-09-25T12:00:00Z");
const point = (
  hoursAgo: number,
  usedPercent: number,
  resetsAt = "2026-09-30T12:00:00Z",
): ProviderUsageSample => ({
  instanceId: ProviderInstanceId.make("better"),
  windowId: "weekly",
  usedPercent,
  sampledAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
  resetsAt,
});
describe("observed quota trend", () => {
  it("projects from actual same-window readings", () => {
    const trend = accountWindowTrend([point(2, 20), point(0, 40)], now);
    expect(trend?.percentPerHour).toBe(10);
    expect(trend?.runsOutAt).toBe(now + 6 * 3_600_000);
  });
  it("does not bridge resets or report a stale or single-point prediction", () => {
    expect(accountWindowTrend([point(2, 90, "2026-09-25T11:00:00Z"), point(0, 5)], now)).toBeNull();
    expect(accountWindowTrend([point(0, 5)], now)).toBeNull();
    expect(accountWindowTrend([point(3, 5), point(2, 10)], now)).toBeNull();
  });
  it("does not extrapolate a refund as a negative burn rate", () => {
    expect(accountWindowTrend([point(2, 40), point(0, 20)], now)).toBeNull();
    expect(accountWindowTrend([point(2, 40), point(0, 40)], now)?.runsOutAt).toBeNull();
  });
});
