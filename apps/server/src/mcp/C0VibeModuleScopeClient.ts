import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { type McpNamedHttpServer, validateMcpNamedHttpServer } from "./McpProviderSession.ts";

export interface C0VibeModuleScopeEnvironment {
  readonly [key: string]: string | undefined;
  readonly C0VIBE_MODULE_SCOPE_URL?: string;
  readonly C0VIBE_MODULE_SCOPE_TOKEN?: string;
}

export interface C0VibeModuleScopeConfig {
  readonly url: string;
  readonly token: string;
}

export interface C0VibeModuleScopeIssueInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
}

export type C0VibeModuleScopeRevokeInput =
  | { readonly providerSessionId: string }
  | { readonly threadId: ThreadId };

export interface C0VibeModuleScopeClientShape {
  readonly issue: (
    input: C0VibeModuleScopeIssueInput,
  ) => Effect.Effect<McpNamedHttpServer | undefined>;
  readonly revoke: (input: C0VibeModuleScopeRevokeInput) => Effect.Effect<void>;
}

export interface C0VibeModuleScopeClientOptions {
  readonly env?: C0VibeModuleScopeEnvironment;
  readonly timeoutMs?: number;
  readonly fetch?: (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => Promise<Response>;
}

type ConfigResolution =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Invalid" }
  | { readonly _tag: "Resolved"; readonly config: C0VibeModuleScopeConfig };

type FailureReason =
  | "unreachable"
  | "timeout"
  | "unauthorized"
  | "malformed"
  | `declined:${"core_agent_unavailable" | "feature_disabled" | "invalid_binding"}`;

class ModuleScopeRequestFailure extends Error {
  readonly reason: FailureReason;

  constructor(reason: FailureReason) {
    super(reason);
    this.name = "ModuleScopeRequestFailure";
    this.reason = reason;
  }
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEFAULT_TIMEOUT_MS = 2_000;
const IssuedResponse = Schema.Struct({
  status: Schema.Literal("issued"),
  server: Schema.Unknown,
});
const DeclinedResponse = Schema.Struct({
  status: Schema.Literal("declined"),
  reason: Schema.Literals(["core_agent_unavailable", "feature_disabled", "invalid_binding"]),
});
const IssueResponse = Schema.Union([IssuedResponse, DeclinedResponse]);
const RevokeResponse = Schema.Struct({
  status: Schema.Literal("revoked"),
  count: Schema.Number,
});
const decodeIssueResponse = Schema.decodeUnknownSync(IssueResponse);
const decodeRevokeResponse = Schema.decodeUnknownSync(RevokeResponse);

function resolveConfig(env: C0VibeModuleScopeEnvironment): ConfigResolution {
  const rawUrl = env.C0VIBE_MODULE_SCOPE_URL;
  const token = env.C0VIBE_MODULE_SCOPE_TOKEN;
  if (!rawUrl?.trim() || !token?.trim()) return { _tag: "Absent" };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { _tag: "Invalid" };
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) {
    return { _tag: "Invalid" };
  }
  return {
    _tag: "Resolved",
    config: { url: url.toString().replace(/\/$/, ""), token },
  };
}

const warnInvalidConfig = Effect.logWarning("C0Vibe module-scope resolver disabled: malformed.");

export const readC0VibeModuleScopeConfig = Effect.fn("C0VibeModuleScopeClient.readConfig")(
  function* (
    env: C0VibeModuleScopeEnvironment = process.env,
  ): Effect.fn.Return<C0VibeModuleScopeConfig | undefined> {
    const resolution = resolveConfig(env);
    if (resolution._tag === "Absent") return undefined;
    if (resolution._tag === "Invalid") {
      yield* warnInvalidConfig;
      return undefined;
    }
    return resolution.config;
  },
);

function operationUrl(config: C0VibeModuleScopeConfig, operation: "issue" | "revoke"): string {
  const url = new URL(config.url);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${operation}`;
  return url.toString();
}

function transportFailure(cause: unknown): ModuleScopeRequestFailure {
  return new ModuleScopeRequestFailure(
    cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")
      ? "timeout"
      : "unreachable",
  );
}

export function makeC0VibeModuleScopeClient(
  options: C0VibeModuleScopeClientOptions = {},
): C0VibeModuleScopeClientShape {
  const resolution = resolveConfig(options.env ?? process.env);
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let invalidConfigWarningLogged = false;

  const readConfig = Effect.fn("C0VibeModuleScopeClient.readResolvedConfig")(function* () {
    if (resolution._tag === "Absent") return undefined;
    if (resolution._tag === "Invalid") {
      if (!invalidConfigWarningLogged) {
        invalidConfigWarningLogged = true;
        yield* warnInvalidConfig;
      }
      return undefined;
    }
    return resolution.config;
  });

  const postJson = (
    config: C0VibeModuleScopeConfig,
    operation: "issue" | "revoke",
    body: unknown,
  ) =>
    Effect.gen(function* () {
      const encodedBody = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
        body,
      ).pipe(Effect.mapError(() => new ModuleScopeRequestFailure("malformed")));
      return yield* Effect.tryPromise({
        try: async () => {
          const response = await fetchRequest(operationUrl(config, operation), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Content-Type": "application/json",
            },
            body: encodedBody,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (response.status === 401) throw new ModuleScopeRequestFailure("unauthorized");
          if (response.status !== 200) {
            throw new ModuleScopeRequestFailure(
              response.status >= 500 ? "unreachable" : "malformed",
            );
          }
          try {
            return (await response.json()) as unknown;
          } catch (error) {
            await Effect.runPromise(
              Effect.logWarning("[c0x-t3-error] moduleScope.invalidResponse", String(error)),
            );
            throw new ModuleScopeRequestFailure("malformed");
          }
        },
        catch: (cause) =>
          cause instanceof ModuleScopeRequestFailure ? cause : transportFailure(cause),
      });
    });

  const issue: C0VibeModuleScopeClientShape["issue"] = Effect.fn("C0VibeModuleScopeClient.issue")(
    function* (input) {
      const config = yield* readConfig();
      if (!config) return undefined;
      const rawResponse = yield* postJson(config, "issue", input);
      const response = yield* Effect.try({
        try: () => decodeIssueResponse(rawResponse),
        catch: () => new ModuleScopeRequestFailure("malformed"),
      });
      if (response.status === "declined") {
        return yield* Effect.fail(new ModuleScopeRequestFailure(`declined:${response.reason}`));
      }
      return yield* Effect.try({
        try: () => validateMcpNamedHttpServer(response.server),
        catch: () => new ModuleScopeRequestFailure("malformed"),
      });
    },
    Effect.catch((failure) =>
      Effect.logWarning(`C0Vibe module-scope issue failed: ${failure.reason}.`).pipe(
        Effect.as(undefined),
      ),
    ),
  );

  const revoke: C0VibeModuleScopeClientShape["revoke"] = Effect.fn(
    "C0VibeModuleScopeClient.revoke",
  )(
    function* (input) {
      const config = yield* readConfig();
      if (!config) return;
      const rawResponse = yield* postJson(config, "revoke", input);
      yield* Effect.try({
        try: () => decodeRevokeResponse(rawResponse),
        catch: () => new ModuleScopeRequestFailure("malformed"),
      });
    },
    Effect.catch((failure) =>
      Effect.logWarning(`C0Vibe module-scope revoke failed: ${failure.reason}.`),
    ),
  );

  return { issue, revoke };
}

const liveClient = makeC0VibeModuleScopeClient();
export const issue = liveClient.issue;
export const revoke = liveClient.revoke;
