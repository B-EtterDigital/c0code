import * as DateTime from "effect/DateTime";
import {
  ProviderInstanceId,
  UsageReadError,
  type ProviderUsageSample,
  type ProviderUsageHistory as UsageHistory,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

const DAY = 86_400_000;
const MIN_SAMPLE_GAP = 5 * 60_000;
interface SampleRow {
  readonly instance_id: string;
  readonly window_id: string;
  readonly used_percent: number;
  readonly resets_at: string | null;
  readonly sampled_at: string;
}

export const makeProviderUsageHistory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  let lastPrunedAt = -Infinity;
  let seen = new Map<string, ServerProvider["usageLimits"]>();
  const record = Effect.fn("ProviderUsageHistory.record")(function* (
    providers: readonly ServerProvider[],
  ) {
    const now = yield* Clock.currentTimeMillis;
    const changed = providers.filter(
      (provider) => seen.get(provider.instanceId) !== provider.usageLimits,
    );
    const prune = now - lastPrunedAt >= 3_600_000;
    if (changed.length === 0 && !prune) return;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const provider of changed) {
          const limits = provider.usageLimits;
          if (!limits || limits.unavailable) continue;
          const sampledAt = Date.parse(limits.checkedAt);
          // Never stamp a cached or invalid reading as fresh.
          if (!Number.isFinite(sampledAt) || sampledAt > now || sampledAt < now - 90 * DAY)
            continue;
          for (const window of limits.windows) {
            const [last] = yield* sql<SampleRow>`SELECT * FROM provider_usage_samples
            WHERE instance_id = ${provider.instanceId} AND window_id = ${window.id}
            ORDER BY sampled_at DESC LIMIT 1`;
            if (
              last &&
              (sampledAt - Date.parse(last.sampled_at) < MIN_SAMPLE_GAP ||
                (last.used_percent === window.usedPercent &&
                  last.resets_at === (window.resetsAt ?? null)))
            )
              continue;
            yield* sql`INSERT INTO provider_usage_samples
            (instance_id, window_id, used_percent, resets_at, sampled_at)
            VALUES (${provider.instanceId}, ${window.id}, ${window.usedPercent}, ${window.resetsAt ?? null}, ${limits.checkedAt})`;
          }
        }
        if (prune)
          yield* sql`DELETE FROM provider_usage_samples WHERE sampled_at < ${DateTime.formatIso(DateTime.makeUnsafe(now - 90 * DAY))}`;
      }),
    );
    // Publish the in-memory checkpoint only after the transaction commits.
    seen = new Map(providers.map((provider) => [provider.instanceId, provider.usageLimits]));
    if (prune) lastPrunedAt = now;
  });
  const read = Effect.fn("ProviderUsageHistory.read")(
    function* (days: number) {
      const now = yield* Clock.currentTimeMillis;
      const since = DateTime.formatIso(
        DateTime.makeUnsafe(now - Math.max(1, Math.min(90, days)) * DAY),
      );
      // One actual reading per hour/window/reset keeps 90-day queries bounded
      // without averaging across resets or manufacturing observations.
      const rows =
        yield* sql<SampleRow>`SELECT instance_id, window_id, used_percent, resets_at, sampled_at
      FROM (SELECT *, ROW_NUMBER() OVER (
        PARTITION BY instance_id, window_id, resets_at, substr(sampled_at, 1, 13)
        ORDER BY sampled_at DESC) AS position FROM provider_usage_samples WHERE sampled_at >= ${since})
      WHERE position = 1 ORDER BY sampled_at ASC`;
      const work = yield* sql<{
        instance_id: string;
        day: string;
        turns: number;
        input_tokens: number;
        output_tokens: number;
        incomplete_turns: number;
      }>`
      WITH unique_turns AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY thread_id, turn_id ORDER BY sequence DESC) AS position
        FROM projection_thread_activities WHERE kind = 'turn.usage' AND created_at >= ${since}
          AND turn_id IS NOT NULL
      )
      SELECT json_extract(payload_json, '$.providerInstanceId') AS instance_id,
        substr(created_at, 1, 10) AS day, COUNT(*) AS turns,
        SUM(COALESCE(json_extract(payload_json, '$.tokenUsage.inputTokens'), 0)) AS input_tokens,
        SUM(COALESCE(json_extract(payload_json, '$.tokenUsage.outputTokens'), 0)) AS output_tokens,
        SUM(CASE WHEN json_extract(payload_json, '$.tokenUsage.usageStatus') = 'complete' THEN 0 ELSE 1 END) AS incomplete_turns
      FROM unique_turns WHERE position = 1 AND json_extract(payload_json, '$.providerInstanceId') IS NOT NULL
      GROUP BY instance_id, day ORDER BY day, instance_id`;
      const samples = rows.map((row): ProviderUsageSample => ({
        instanceId: ProviderInstanceId.make(row.instance_id),
        windowId: row.window_id,
        usedPercent: row.used_percent,
        resetsAt: row.resets_at,
        sampledAt: row.sampled_at,
      }));
      return {
        samples,
        dailyWork: work.map((row) => ({
          instanceId: ProviderInstanceId.make(row.instance_id),
          day: row.day,
          turns: row.turns,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          incompleteTurns: row.incomplete_turns,
        })),
      };
    },
    Effect.mapError(
      (cause) =>
        new UsageReadError({
          reason: "scanFailed",
          detail: "Could not read account usage history.",
          cause,
        }),
    ),
  );
  return { record, read };
});

export class ProviderUsageHistory extends Context.Service<
  ProviderUsageHistory,
  {
    readonly read: (days: number) => Effect.Effect<UsageHistory, UsageReadError>;
  }
>()("t3/usage/ProviderUsageHistory") {}

export const layer = Layer.effect(
  ProviderUsageHistory,
  Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    const history = yield* makeProviderUsageHistory;
    const record = (providers: readonly ServerProvider[]) =>
      history.record(providers).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logError("Account usage history sampling failed", {
                cause: Cause.pretty(cause),
              }),
        ),
      );
    // One server-owned subscriber, independent of how many browser windows open Usage.
    yield* Stream.runForEach(registry.streamChanges, record).pipe(Effect.forkScoped);
    yield* record(yield* registry.getProviders);
    return { read: history.read };
  }),
);
