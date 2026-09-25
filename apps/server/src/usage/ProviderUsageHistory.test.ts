import { runMigrations } from "../persistence/Migrations.ts";
import * as DateTime from "effect/DateTime";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import migration from "../persistence/Migrations/051_ProviderUsageSamples.ts";
import { makeProviderUsageHistory } from "./ProviderUsageHistory.ts";

const start = Date.parse("2026-09-25T12:00:00.000Z");
function provider(used: number, time = start, reset = "2026-09-30T12:00:00.000Z"): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("better"),
    driver: ProviderDriverKind.make("codex"),
    enabled: false,
    installed: true,
    status: "disabled",
    version: null,
    auth: { status: "authenticated" },
    checkedAt: DateTime.formatIso(DateTime.makeUnsafe(time)),
    models: [],
    skills: [],
    slashCommands: [],
    usageLimits: {
      checkedAt: DateTime.formatIso(DateTime.makeUnsafe(time)),
      windows: [
        { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: used, resetsAt: reset },
      ],
    },
  };
}
it.layer(NodeSqliteClient.layerMemory())("account history", (it) => {
  it.effect("samples disabled accounts, throttles changed readings, and ignores old reports", () =>
    Effect.gen(function* () {
      const setupSql = yield* SqlClient.SqlClient;
      yield* setupSql`DROP TABLE IF EXISTS provider_usage_samples`;
      yield* runMigrations({ toMigrationInclusive: 50 });
      yield* migration;
      yield* TestClock.setTime(start);
      const history = yield* makeProviderUsageHistory;
      yield* history.record([provider(10)]);
      yield* TestClock.adjust("1 minute");
      yield* history.record([provider(20, start + 60_000)]);
      yield* TestClock.adjust("4 minutes");
      yield* history.record([provider(30, start + 300_000)]);
      yield* history.record([provider(5)]);
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`SELECT used_percent FROM provider_usage_samples ORDER BY sampled_at`;
      assert.deepEqual(rows, [{ used_percent: 10 }, { used_percent: 30 }]);
      const hourly = yield* history.read(7);
      assert.strictEqual(hourly.samples.length, 1);
      assert.strictEqual(hourly.samples[0]?.usedPercent, 30);
    }),
  );
  it.effect("keeps reset boundaries, skips unchanged readings, and prunes after 90 days", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TABLE IF EXISTS provider_usage_samples`;
      yield* runMigrations({ toMigrationInclusive: 50 });
      yield* migration;
      yield* TestClock.setTime(start);
      const history = yield* makeProviderUsageHistory;
      yield* history.record([provider(90)]);
      yield* TestClock.adjust("5 minutes");
      yield* history.record([provider(90, start + 300_000)]);
      yield* history.record([provider(5, start + 300_000, "2026-10-07T12:00:00.000Z")]);
      assert.strictEqual((yield* history.read(7)).samples.length, 2);
      yield* TestClock.adjust("91 days");
      yield* history.record([]);
      assert.deepEqual((yield* history.read(90)).samples, []);
    }),
  );
  it.effect("counts each completed turn once and keeps its recorded account after a switch", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(start);
      yield* runMigrations({ toMigrationInclusive: 50 });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TABLE IF EXISTS provider_usage_samples`;
      yield* migration;
      yield* sql`DELETE FROM projection_thread_activities`;
      for (const [id, sequence, account, turn] of [
        ["old", 1, "poly", "turn-a"],
        ["new", 2, "poly", "turn-a"],
        ["next", 3, "better", "turn-b"],
      ] as const) {
        const payload =
          account === "poly"
            ? '{"providerInstanceId":"poly","tokenUsage":{"usageStatus":"complete","inputTokens":100,"outputTokens":20}}'
            : '{"providerInstanceId":"better","tokenUsage":{"usageStatus":"partial","inputTokens":30}}';
        yield* sql`INSERT INTO projection_thread_activities
        (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, created_at, sequence)
        VALUES (${id}, 'thread', ${turn}, 'info', 'turn.usage', 'Usage', ${payload}, '2026-09-25T12:00:00.000Z', ${sequence})`;
      }
      const history = yield* makeProviderUsageHistory;
      assert.deepEqual((yield* history.read(7)).dailyWork, [
        {
          instanceId: "better",
          day: "2026-09-25",
          turns: 1,
          inputTokens: 30,
          outputTokens: 0,
          incompleteTurns: 1,
        },
        {
          instanceId: "poly",
          day: "2026-09-25",
          turns: 1,
          inputTokens: 100,
          outputTokens: 20,
          incompleteTurns: 0,
        },
      ]);
    }),
  );
});
