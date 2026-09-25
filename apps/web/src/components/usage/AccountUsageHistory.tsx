import { quotaRemaining } from "@t3tools/shared/providerSwitch";
import type {
  EnvironmentId,
  ProviderUsageSample,
  ProviderDailyWork,
  ServerProvider,
} from "@t3tools/contracts";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { accountWindowTrend } from "@t3tools/shared/accountUsage";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { LimitWindows, barColor } from "./UsageLimits";

function AccountCard({
  provider,
  environmentId,
  samples,
  work,
  now,
}: {
  readonly provider: ServerProvider;
  readonly environmentId: EnvironmentId;
  readonly samples: readonly ProviderUsageSample[];
  readonly now: number;
  readonly work: readonly ProviderDailyWork[];
}) {
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const color = provider.accentColor ?? barColor(provider.driver);
  const name = provider.displayName ?? provider.instanceId;
  const turns = work.reduce((total, day) => total + day.turns, 0);
  const tokens = work.reduce((total, day) => total + day.inputTokens + day.outputTokens, 0);
  const incomplete = work.reduce((total, day) => total + day.incompleteTurns, 0);
  const limits = provider.usageLimits;
  const checked =
    limits && !limits.unavailable ? new Date(limits.checkedAt).toLocaleString() : null;
  const update = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await refresh({ environmentId, input: { instanceId: provider.instanceId } });
      if (result._tag === "Failure")
        setError("Could not refresh this account. The last reading is preserved.");
      else {
        const updated = result.value.providers.find(
          (entry) => entry.instanceId === provider.instanceId,
        );
        if (updated?.usageLimits?.unavailable || updated?.status === "error")
          setError("The account could not provide a fresh reading.");
        else if (updated?.usageLimits?.checkedAt === limits?.checkedAt)
          setError("Showing the cached reading. Another probe is not available yet.");
      }
    } catch (cause) {
      console.error(
        "[account-usage] Refresh failed",
        cause instanceof Error ? cause.message : "Unknown error",
      );
      setError("Could not refresh this account.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-lg border border-border p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="font-medium wrap-anywhere"
            style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8 }}
          >
            {name}
          </h3>
          <p className="mt-1 text-muted-foreground">
            {provider.enabled ? "Enabled" : "Disabled"}
            {checked ? ` · Checked ${checked}` : " · No successful quota reading"}
          </p>
        </div>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => void update()}
          aria-label={`Refresh ${name}`}
        >
          <RefreshCwIcon
            className={busy ? "size-3 animate-spin motion-reduce:animate-none" : "size-3"}
            aria-hidden
          />
          {busy ? "Checking…" : "Refresh"}
        </Button>
      </div>
      <p className="mt-2 text-muted-foreground">
        {turns} recorded turns · {tokens.toLocaleString()} reported tokens
        {incomplete ? ` · ${incomplete} turns have incomplete token totals` : ""}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      ) : null}
      {limits && !limits.unavailable ? (
        <div className="mt-3">
          <LimitWindows driver={provider.driver} windows={limits.windows} now={now} />
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground">
          {limits?.unavailable?.message ?? "Quota unavailable"}
        </p>
      )}
      {limits?.windows.map((window) => {
        const points = samples.filter((sample) => sample.windowId === window.id);
        const current = points.filter((sample) => sample.resetsAt === (window.resetsAt ?? null));
        const trend = accountWindowTrend(current, now);
        const start = now - 7 * 86_400_000;
        const segments = new Map<string, ProviderUsageSample[]>();
        for (const point of points) {
          const key = point.resetsAt ?? "unknown";
          const group = segments.get(key) ?? [];
          group.push(point);
          segments.set(key, group);
        }
        const x = (date: string) =>
          Math.max(0, Math.min(360, ((Date.parse(date) - start) / (now - start)) * 360));
        return (
          <div key={window.id} className="mt-3 border-t border-border pt-2">
            <div className="flex justify-between gap-2 text-muted-foreground">
              <span>{window.label} · used quota</span>
              <span>Last 7 days</span>
            </div>
            {points.length >= 2 ? (
              <svg
                viewBox="0 0 360 104"
                className="mt-1 h-24 w-full"
                role="img"
                aria-label={`${name}, ${window.label}: recorded used percentage over seven days`}
              >
                <path
                  d="M0 2H360 M0 52H360 M0 102H360"
                  stroke="currentColor"
                  className="text-border"
                  fill="none"
                />
                {[...segments.values()].map((group) => (
                  <polyline
                    key={group[0]!.sampledAt}
                    points={group
                      .map((point) => `${x(point.sampledAt)},${102 - point.usedPercent}`)
                      .join(" ")}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                  />
                ))}
                {[...new Set(points.map((point) => point.resetsAt))]
                  .filter(
                    (reset): reset is string =>
                      reset !== null && Date.parse(reset) >= start && Date.parse(reset) <= now,
                  )
                  .map((reset) => (
                    <line
                      key={reset}
                      x1={x(reset)}
                      x2={x(reset)}
                      y1="2"
                      y2="102"
                      stroke="currentColor"
                      strokeDasharray="3 3"
                      className="text-muted-foreground"
                    >
                      <title>Quota reset {new Date(reset).toLocaleString()}</title>
                    </line>
                  ))}
                {points.map((point) => (
                  <circle
                    key={point.sampledAt}
                    cx={x(point.sampledAt)}
                    cy={102 - point.usedPercent}
                    r="2"
                    fill={color}
                  >
                    <title>
                      {new Date(point.sampledAt).toLocaleString()}: {point.usedPercent}% used
                    </title>
                  </circle>
                ))}
              </svg>
            ) : (
              <p className="my-3 text-muted-foreground">
                History starts with recorded readings. More data is needed for a graph.
              </p>
            )}
            <p className="text-muted-foreground">
              {trend
                ? `${trend.percentPerHour.toFixed(1)} percentage points/hour over ${trend.observedHours.toFixed(1)} observed hours.`
                : "Not enough recent readings to estimate usage pace."}
            </p>
            {trend?.runsOutAt ? (
              <p className="mt-1">
                At this pace, runs out {new Date(trend.runsOutAt).toLocaleString()}
                {window.resetsAt && trend.runsOutAt < Date.parse(window.resetsAt)
                  ? ", before reset."
                  : window.resetsAt
                    ? ", after the next reset."
                    : "."}
              </p>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

export function AccountUsageHistory({
  environmentId,
  providers,
}: {
  readonly environmentId: EnvironmentId;
  readonly providers: readonly ServerProvider[];
}) {
  const query = serverEnvironment.providerUsageHistory({ environmentId, input: { days: 7 } });
  const result = useAtomValue(query);
  const refreshHistory = useAtomRefresh(query);
  const history = Option.getOrElse(AsyncResult.value(result), () => ({
    samples: [],
    dailyWork: [],
  }));
  const { samples, dailyWork } = history;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      refreshHistory();
    }, 60_000);
    return () => clearInterval(timer);
  }, [refreshHistory]);
  const accounts = providers;
  if (accounts.length === 0) return null;
  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Account history</h2>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setNow(Date.now());
            refreshHistory();
          }}
        >
          Refresh history
        </Button>
      </div>
      {result._tag === "Failure" ? (
        <p role="alert" className="text-xs text-destructive">
          This environment could not report account history.
        </p>
      ) : null}
      {result.waiting ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading history…
        </p>
      ) : null}
      <ResetTimeline providers={providers} now={now} />
      <DailyWorkChart work={dailyWork} providers={providers} />
      <p className="text-xs text-muted-foreground">
        Account work is recorded from this build onward. Earlier shared-store conversations are not
        assigned to an account by guesswork.
      </p>
      {accounts.map((provider) => (
        <AccountCard
          key={provider.instanceId}
          provider={provider}
          environmentId={environmentId}
          samples={samples.filter((sample) => sample.instanceId === provider.instanceId)}
          work={dailyWork.filter((day) => day.instanceId === provider.instanceId)}
          now={now}
        />
      ))}
    </div>
  );
}

function DailyWorkChart({
  work,
  providers,
}: {
  readonly work: readonly ProviderDailyWork[];
  readonly providers: readonly ServerProvider[];
}) {
  const days = [...new Set(work.map((day) => day.day))].sort();
  const totals = days.map((day) =>
    work.filter((entry) => entry.day === day).reduce((sum, entry) => sum + entry.turns, 0),
  );
  const max = Math.max(1, ...totals);
  if (days.length === 0) return null;
  return (
    <div className="rounded-lg border border-border p-3">
      <h3 className="text-xs font-medium">Daily work by account · turns · UTC</h3>
      <div className="mt-3 flex flex-col gap-2">
        {days.map((day) => (
          <div key={day} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 text-muted-foreground">{day}</span>
            <div
              className="flex h-5 flex-1 overflow-hidden rounded-sm bg-muted"
              role="img"
              aria-label={work
                .filter((entry) => entry.day === day)
                .map(
                  (entry) =>
                    `${providers.find((provider) => provider.instanceId === entry.instanceId)?.displayName ?? entry.instanceId}: ${entry.turns} turns`,
                )
                .join(", ")}
            >
              {work
                .filter((entry) => entry.day === day)
                .map((entry) => {
                  const provider = providers.find(
                    (candidate) => candidate.instanceId === entry.instanceId,
                  );
                  return (
                    <span
                      key={entry.instanceId}
                      style={{
                        width: `${(entry.turns / max) * 100}%`,
                        backgroundColor:
                          provider?.accentColor ??
                          (provider ? barColor(provider.driver) : "var(--primary)"),
                      }}
                    />
                  );
                })}
            </div>
            <span className="w-6 text-right tabular-nums">{totals[days.indexOf(day)]}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {providers
          .filter((provider) => work.some((entry) => entry.instanceId === provider.instanceId))
          .map((provider) => (
            <span key={provider.instanceId} className="inline-flex items-center gap-1">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: provider.accentColor ?? barColor(provider.driver) }}
              />
              {provider.displayName ?? provider.instanceId}
            </span>
          ))}
      </div>
    </div>
  );
}

function ResetTimeline({
  providers,
  now,
}: {
  readonly providers: readonly ServerProvider[];
  readonly now: number;
}) {
  const groups = new Map<string, ServerProvider[]>();
  for (const provider of providers) {
    const key = provider.continuation?.groupKey;
    if (!key || !provider.usageLimits) continue;
    const group = groups.get(key) ?? [];
    group.push(provider);
    groups.set(key, group);
  }
  const resets = providers
    .flatMap(
      (provider) =>
        provider.usageLimits?.windows.flatMap((window) => {
          const reset = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
          return Number.isFinite(reset) && reset > now ? [{ provider, window, reset }] : [];
        }) ?? [],
    )
    .sort((a, b) => a.reset - b.reset);
  const end = Math.max(now + 86_400_000, ...resets.map((entry) => entry.reset));
  if (resets.length === 0 && groups.size === 0) return null;
  return (
    <section className="rounded-lg border border-border p-3 text-xs">
      <h3 className="font-medium">Capacity and resets</h3>
      {[...groups].map(([key, group]) => (
        <p key={key} className="mt-2 text-muted-foreground">
          {
            group.filter(
              (provider) =>
                provider.enabled && (quotaRemaining(provider.usageLimits, now) ?? 0) > 0,
            ).length
          }{" "}
          of {group.length} configured {group[0]!.driver === "codex" ? "GPT" : group[0]!.driver}{" "}
          accounts have confirmed capacity in this conversation store.
        </p>
      ))}
      <div className="mt-3 flex flex-col gap-3">
        {resets.map(({ provider, window, reset }) => (
          <div key={`${provider.instanceId}:${window.id}`}>
            <div className="flex flex-wrap justify-between gap-1">
              <span>
                {provider.displayName ?? provider.instanceId} · {window.label}
                {provider.enabled ? "" : " · Disabled"}
              </span>
              <span className="text-muted-foreground">{new Date(reset).toLocaleString()}</span>
            </div>
            <div
              className="relative mt-1 h-1 rounded-full bg-muted"
              role="img"
              aria-label={`${provider.displayName ?? provider.instanceId} ${window.label} resets ${new Date(reset).toLocaleString()}`}
            >
              <span
                className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${Math.min(99, Math.max(1, ((reset - now) / (end - now)) * 100))}%`,
                  backgroundColor: provider.accentColor ?? barColor(provider.driver),
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
