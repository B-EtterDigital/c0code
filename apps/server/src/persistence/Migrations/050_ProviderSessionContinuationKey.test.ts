import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layerMemory())("050_ProviderSessionContinuationKey", (it) => {
  it.effect("preserves existing conversation cursors without guessing a store identity", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* sql`INSERT INTO provider_session_runtime
        (thread_id, provider_name, provider_instance_id, adapter_key, runtime_mode, status, last_seen_at, resume_cursor_json)
        VALUES ('thread-1', 'codex', 'codex-poly', 'codex', 'full-access', 'stopped', '2026-09-25T00:00:00.000Z', '{"threadId":"native-1"}')`;
      yield* runMigrations({ toMigrationInclusive: 50 });
      const rows =
        yield* sql`SELECT continuation_key, resume_cursor_json, provider_instance_id FROM provider_session_runtime`;
      assert.deepEqual(rows, [
        {
          continuation_key: null,
          resume_cursor_json: '{"threadId":"native-1"}',
          provider_instance_id: "codex-poly",
        },
      ]);
    }),
  );
});
