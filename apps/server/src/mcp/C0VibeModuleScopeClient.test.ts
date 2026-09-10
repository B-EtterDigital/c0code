// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";

import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

import { makeC0VibeModuleScopeClient } from "./C0VibeModuleScopeClient.ts";

const resolverSecret = "resolver-secret-private";
const issuedToken = "issued-scope-token-private";
const issueInput = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
};

interface Fixture {
  readonly server: NodeHttp.Server;
  readonly url: string;
}

function startFixture(handler: NodeHttp.RequestListener): Promise<Fixture> {
  return new Promise((resolve, reject) => {
    const server = NodeHttp.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Fixture did not bind a TCP address."));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/native-scope` });
    });
  });
}

function stopFixture(fixture: Fixture): Promise<void> {
  fixture.server.closeAllConnections();
  return new Promise((resolve, reject) => {
    fixture.server.close((error) => (error ? reject(error) : resolve()));
  });
}

const withFixture = <A, E, R>(
  handler: NodeHttp.RequestListener,
  use: (fixture: Fixture) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.promise(() => startFixture(handler)),
    use,
    (fixture) => Effect.promise(() => stopFixture(fixture)),
  );

function sendJson(response: NodeHttp.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function captureWarnings(logs: string[]) {
  return Logger.layer(
    [
      Logger.make<unknown, void>(({ message }) => {
        logs.push(String(message));
      }),
    ],
    { mergeWithExisting: false },
  );
}

function clientAt(url: string, timeoutMs = 2_000) {
  return makeC0VibeModuleScopeClient({
    env: {
      C0VIBE_MODULE_SCOPE_URL: url,
      C0VIBE_MODULE_SCOPE_TOKEN: resolverSecret,
    },
    timeoutMs,
  });
}

it.effect("issues a validated named MCP server from the loopback resolver", () => {
  let requests = 0;
  return withFixture(
    (request, response) => {
      requests += 1;
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/native-scope/issue");
      assert.equal(request.headers.authorization, `Bearer ${resolverSecret}`);
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        assert.deepEqual(JSON.parse(body), issueInput);
        sendJson(response, 200, {
          status: "issued",
          server: {
            name: "c0vibe",
            endpoint: "http://127.0.0.1:43124/mcp",
            authorizationHeader: `Bearer ${issuedToken}`,
          },
        });
      });
    },
    (fixture) =>
      Effect.gen(function* () {
        const issued = yield* clientAt(fixture.url).issue(issueInput);
        assert.deepEqual(issued, {
          name: "c0vibe",
          endpoint: "http://127.0.0.1:43124/mcp",
          authorizationHeader: `Bearer ${issuedToken}`,
        });
        assert.equal(requests, 1);
      }),
  );
});

it.effect("maps a declined issue to undefined and one reason-only warning", () => {
  const warnings: string[] = [];
  return withFixture(
    (_request, response) =>
      sendJson(response, 200, { status: "declined", reason: "core_agent_unavailable" }),
    (fixture) =>
      Effect.gen(function* () {
        assert.isUndefined(yield* clientAt(fixture.url).issue(issueInput));
        assert.deepEqual(warnings, [
          "C0Vibe module-scope issue failed: declined:core_agent_unavailable.",
        ]);
      }).pipe(Effect.provide(captureWarnings(warnings))),
  );
});

it.effect("maps resolver authorization failure to undefined", () => {
  const warnings: string[] = [];
  return withFixture(
    (_request, response) => response.writeHead(401).end(),
    (fixture) =>
      Effect.gen(function* () {
        assert.isUndefined(yield* clientAt(fixture.url).issue(issueInput));
        assert.deepEqual(warnings, ["C0Vibe module-scope issue failed: unauthorized."]);
      }).pipe(Effect.provide(captureWarnings(warnings))),
  );
});

it.effect("times out when the resolver never answers", () => {
  const warnings: string[] = [];
  let requests = 0;
  return withFixture(
    () => {
      requests += 1;
    },
    (fixture) =>
      Effect.gen(function* () {
        assert.isUndefined(yield* clientAt(fixture.url, 25).issue(issueInput));
        assert.equal(requests, 1);
        assert.deepEqual(warnings, ["C0Vibe module-scope issue failed: timeout."]);
      }).pipe(Effect.provide(captureWarnings(warnings))),
  );
});

it.effect("maps malformed JSON to undefined", () => {
  const warnings: string[] = [];
  return withFixture(
    (_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{not-json");
    },
    (fixture) =>
      Effect.gen(function* () {
        assert.isUndefined(yield* clientAt(fixture.url).issue(issueInput));
        assert.deepEqual(warnings, ["C0Vibe module-scope issue failed: malformed."]);
      }).pipe(Effect.provide(captureWarnings(warnings))),
  );
});

it.effect("does not put resolver or scoped secrets in warning text", () => {
  const warnings: string[] = [];
  return withFixture(
    (_request, response) =>
      sendJson(response, 200, {
        status: "issued",
        server: {
          name: "c0vibe",
          endpoint: "https://remote.example/mcp",
          authorizationHeader: `Bearer ${issuedToken}`,
        },
      }),
    (fixture) =>
      Effect.gen(function* () {
        assert.isUndefined(yield* clientAt(fixture.url).issue(issueInput));
        const warningText = warnings.join("\n");
        assert.notInclude(warningText, resolverSecret);
        assert.notInclude(warningText, issuedToken);
        assert.equal(warnings.length, 1);
      }).pipe(Effect.provide(captureWarnings(warnings))),
  );
});

it.effect("makes no request when resolver environment is absent", () => {
  let requests = 0;
  const client = makeC0VibeModuleScopeClient({
    env: {},
    fetch: () => {
      requests += 1;
      return Promise.reject(new Error("must not request"));
    },
  });
  return Effect.gen(function* () {
    assert.isUndefined(yield* client.issue(issueInput));
    assert.equal(requests, 0);
  });
});

it.effect("refuses a non-loopback resolver without making a request", () => {
  const warnings: string[] = [];
  let requests = 0;
  const client = makeC0VibeModuleScopeClient({
    env: {
      C0VIBE_MODULE_SCOPE_URL: "http://example.com/native-scope",
      C0VIBE_MODULE_SCOPE_TOKEN: resolverSecret,
    },
    fetch: () => {
      requests += 1;
      return Promise.reject(new Error("must not request"));
    },
  });
  return Effect.gen(function* () {
    assert.isUndefined(yield* client.issue(issueInput));
    assert.isUndefined(yield* client.issue(issueInput));
    assert.equal(requests, 0);
    assert.deepEqual(warnings, ["C0Vibe module-scope resolver disabled: malformed."]);
    assert.notInclude(warnings.join("\n"), resolverSecret);
  }).pipe(Effect.provide(captureWarnings(warnings)));
});
