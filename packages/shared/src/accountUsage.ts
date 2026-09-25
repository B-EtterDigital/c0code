import type { ProviderUsageSample } from "@t3tools/contracts";

/** Compare actual readings only within one quota window, never across a reset. */
export function accountWindowTrend(samples: readonly ProviderUsageSample[], now: number) {
  const sorted = samples
    .filter((sample) => Date.parse(sample.sampledAt) <= now)
    .toSorted((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
  const latest = sorted.at(-1);
  if (!latest) return null;
  const since = sorted.find(
    (sample) =>
      sample.instanceId === latest.instanceId &&
      sample.windowId === latest.windowId &&
      sample.resetsAt === latest.resetsAt &&
      Date.parse(sample.sampledAt) >= now - 86_400_000,
  );
  const elapsed = since ? Date.parse(latest.sampledAt) - Date.parse(since.sampledAt) : 0;
  if (
    !since ||
    elapsed < 300_000 ||
    latest.usedPercent < since.usedPercent ||
    now - Date.parse(latest.sampledAt) > 3_600_000
  )
    return null;
  const percentPerHour = (latest.usedPercent - since.usedPercent) / (elapsed / 3_600_000);
  return {
    percentPerHour,
    observedHours: elapsed / 3_600_000,
    runsOutAt:
      percentPerHour > 0
        ? Date.parse(latest.sampledAt) + ((100 - latest.usedPercent) / percentPerHour) * 3_600_000
        : null,
  };
}
