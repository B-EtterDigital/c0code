import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "./Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("current T3 profile", (it) => {
  it.effect(
    "adds C0CODE data after upstream 54 without changing messages, context, or resume cursors",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 54 });
        yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at, attachments_json, context_json)
      VALUES ('message', 'thread', 'user', 'Preserve this conversation', 0, '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z', '[]', '{"source":"test"}')`;
        yield* sql`INSERT INTO provider_session_runtime (thread_id, provider_name, provider_instance_id, adapter_key, runtime_mode, status, last_seen_at, resume_cursor_json)
      VALUES ('thread', 'codex', 'codex-poly', 'codex', 'full-access', 'stopped', '2026-09-25T00:00:00Z', '{"threadId":"native-thread"}')`;
        const before = yield* sql`SELECT * FROM projection_thread_messages`;
        assert.deepEqual(yield* runMigrations(), [
          [55, "ProviderSessionContinuationKey"],
          [56, "ProviderUsageSamples"],
        ]);
        assert.deepEqual(yield* sql`SELECT * FROM projection_thread_messages`, before);
        assert.deepEqual(
          yield* sql`SELECT resume_cursor_json, continuation_key FROM provider_session_runtime`,
          [{ resume_cursor_json: '{"threadId":"native-thread"}', continuation_key: null }],
        );
        assert.deepEqual(yield* runMigrations(), []);
      }),
  );
});

it.layer(NodeSqliteClient.layerMemory())("unreleased conflicting C0CODE profile", (it) => {
  it.effect("refuses a reused migration number before changing the ledger or schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (50, 'ProviderSessionContinuationKey')`;
      const before = yield* sql`SELECT * FROM effect_sql_migrations`;
      const failure = yield* Effect.flip(runMigrations());
      assert.include(String(failure), "Incompatible database migration 50");
      assert.deepEqual(yield* sql`SELECT * FROM effect_sql_migrations`, before);
      assert.deepEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name = 'provider_usage_samples'`,
        [],
      );
    }),
  );
});

it.layer(NodeSqliteClient.layerMemory())("future profile", (it) => {
  it.effect("refuses newer unknown migrations without pretending the database is current", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (57, 'FutureMigration')`;
      const failure = yield* Effect.flip(runMigrations());
      assert.include(String(failure), "Incompatible database migration 57");
      assert.deepEqual(
        yield* sql`SELECT name FROM sqlite_master WHERE name = 'provider_usage_samples'`,
        [],
      );
    }),
  );
});
