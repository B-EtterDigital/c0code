import type { ProviderSwitchCandidate, ServerProviderUsageLimits } from "@t3tools/contracts";

/** Expired windows require another read; their reset does not prove renewed capacity. */
export function quotaRemaining(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
): number | null {
  if (!limits || limits.unavailable) return null;
  if (limits.ordinaryUsageAllowed === false) return 0;
  if (limits.windows.length === 0) return null;
  const checkedAt = Date.parse(limits.checkedAt);
  if (!Number.isFinite(checkedAt) || now - checkedAt > 5 * 60_000) return null;
  if (limits.windows.some((window) => window.resetsAt && Date.parse(window.resetsAt) <= now))
    return null;
  return Math.min(...limits.windows.map((window) => Math.max(0, 100 - window.usedPercent)));
}

export function isQuotaExhausted(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
): boolean {
  if (!limits) return false;
  if (limits.ordinaryUsageAllowed === false) return true;
  // A stale positive balance is unsafe for automatic switching. A known
  // exhausted window, however, remains exhausted until its reset or a new read.
  return limits.windows.some(
    (window) =>
      window.usedPercent >= 100 && (!window.resetsAt || Date.parse(window.resetsAt) > now),
  );
}

function nextReset(candidate: ProviderSwitchCandidate, now: number): number {
  const resets =
    candidate.usageLimits?.windows.flatMap((window) => {
      const reset = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
      return Number.isFinite(reset) && reset > now ? [reset] : [];
    }) ?? [];
  return resets.length ? Math.min(...resets) : Infinity;
}

export function rankProviderSwitchCandidates<T extends ProviderSwitchCandidate>(
  candidates: readonly T[],
  now: number,
): T[] {
  return [...candidates].sort(
    (a, b) =>
      Number(b.keepsConversation) - Number(a.keepsConversation) ||
      (quotaRemaining(b.usageLimits, now) ?? -1) - (quotaRemaining(a.usageLimits, now) ?? -1) ||
      nextReset(a, now) - nextReset(b, now) ||
      a.instanceId.localeCompare(b.instanceId),
  );
}

export function automaticSwitchCandidate<T extends ProviderSwitchCandidate>(
  candidates: readonly T[],
  now: number,
): T | undefined {
  return rankProviderSwitchCandidates(candidates, now).find(
    (candidate) =>
      candidate.keepsConversation &&
      candidate.enabled &&
      (quotaRemaining(candidate.usageLimits, now) ?? 0) > 0,
  );
}

export function quotaSwitchNotice(
  targetName: string,
  source: {
    readonly displayName?: string | undefined;
    readonly instanceId: string;
    readonly usageLimits?: ServerProviderUsageLimits | undefined;
  },
): string {
  const reset = source.usageLimits?.windows
    .filter((window) => window.usedPercent >= 100 && window.resetsAt)
    .map((window) => Date.parse(window.resetsAt!))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (reset === undefined) return `Switched to ${targetName}.`;
  const label = new Date(reset).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Switched to ${targetName}. ${source.displayName ?? source.instanceId} resets ${label}.`;
}
