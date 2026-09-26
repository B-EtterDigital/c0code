import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

interface LegacyLinkedThreadRow {
  readonly threadId: string;
  readonly updatedAt: string;
  readonly linkedPullRequestJson: string;
}

interface LegacyLinkedPullRequest {
  readonly repository: string;
  readonly number: number;
  readonly url: string;
}

const decodeLegacy = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      repository: Schema.String.check(Schema.isNonEmpty()),
      number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
      url: Schema.String.check(Schema.isNonEmpty()),
    }),
  ),
);

// This branch predates upstream's multi-link service; keep its migration's
// legacy identity conversion local until that service is ported.
function legacyThreadPullRequestKey(linked: LegacyLinkedPullRequest) {
  const url = URL.canParse(linked.url) ? new URL(linked.url) : null;
  let host = url?.hostname.toLowerCase() ?? "unknown";
  let repository = linked.repository.trim().toLowerCase();
  const path = url?.pathname.toLowerCase() ?? "";
  const azure = path.match(/^\/(.+)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/);
  if (azure && Number(azure[3]) === linked.number) {
    if (host === "dev.azure.com") repository = `${azure[1]}/_git/${azure[2]}`;
    else if (host.endsWith(".visualstudio.com")) {
      repository = `${host.slice(0, -".visualstudio.com".length)}/${azure[1]!.replace(/^defaultcollection\//, "")}/_git/${azure[2]}`;
      host = "dev.azure.com";
    }
  } else if (url?.port && /\/pulls\/\d+\/?$/.test(path)) host = url.host.toLowerCase();
  return { host, repository };
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_pull_requests (
      thread_id TEXT NOT NULL,
      host TEXT NOT NULL,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      snapshot_json TEXT,
      stack_json TEXT,
      PRIMARY KEY (thread_id, host, repository, number)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_pull_requests_pr
    ON projection_thread_pull_requests(host, repository, number)
  `;

  const legacyRows = yield* sql<LegacyLinkedThreadRow>`
    SELECT
      thread_id AS "threadId",
      updated_at AS "updatedAt",
      linked_pull_request_json AS "linkedPullRequestJson"
    FROM projection_threads
    WHERE linked_pull_request_json IS NOT NULL
  `;

  for (const row of legacyRows) {
    const decoded = decodeLegacy(row.linkedPullRequestJson);
    if (Option.isNone(decoded) || !decoded.value.repository.trim() || !decoded.value.url.trim()) {
      yield* Effect.logWarning("Skipping malformed legacy pull request link during migration", {
        threadId: row.threadId,
      });
      continue;
    }
    const linked = decoded.value;
    const key = legacyThreadPullRequestKey(linked);
    yield* sql`
      INSERT OR IGNORE INTO projection_thread_pull_requests (
        thread_id,
        host,
        repository,
        number,
        url,
        source,
        linked_at,
        snapshot_json,
        stack_json
      )
      VALUES (
        ${row.threadId},
        ${key.host},
        ${key.repository},
        ${linked.number},
        ${linked.url},
        'manual',
        ${row.updatedAt},
        NULL,
        NULL
      )
    `;
  }
});
