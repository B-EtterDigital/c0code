import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE provider_usage_samples (
    instance_id TEXT NOT NULL,
    window_id TEXT NOT NULL,
    used_percent REAL NOT NULL CHECK (used_percent >= 0 AND used_percent <= 100),
    resets_at TEXT,
    sampled_at TEXT NOT NULL,
    PRIMARY KEY (instance_id, window_id, sampled_at)
  )`;
  yield* sql`CREATE INDEX provider_usage_samples_retention ON provider_usage_samples(sampled_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS projection_activity_usage_history
    ON projection_thread_activities(kind, created_at) WHERE kind = 'turn.usage'`;
});
