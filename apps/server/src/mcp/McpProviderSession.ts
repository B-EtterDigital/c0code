import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface McpNamedHttpServer {
  readonly name: string;
  readonly endpoint: string;
  readonly authorizationHeader: string;
}

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  readonly additionalServers?: ReadonlyArray<McpNamedHttpServer>;
}

export type McpNamedHttpServerValidationReason =
  | "invalid_shape"
  | "invalid_name"
  | "reserved_name"
  | "invalid_endpoint"
  | "unsupported_endpoint_scheme"
  | "non_loopback_endpoint"
  | "invalid_authorization_header"
  | "duplicate_name";

export class McpNamedHttpServerValidationError extends Error {
  readonly _tag = "McpNamedHttpServerValidationError";
  readonly reason: McpNamedHttpServerValidationReason;

  constructor(reason: McpNamedHttpServerValidationReason) {
    super(`Invalid named MCP HTTP server: ${reason}.`);
    this.name = "McpNamedHttpServerValidationError";
    this.reason = reason;
  }
}

const McpNamedHttpServerShape = Schema.Struct({
  name: Schema.String,
  endpoint: Schema.String,
  authorizationHeader: Schema.String,
});
const decodeMcpNamedHttpServerShape = Schema.decodeUnknownSync(McpNamedHttpServerShape);
const MCP_SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function validateMcpNamedHttpServer(candidate: unknown): McpNamedHttpServer {
  let server: McpNamedHttpServer;
  try {
    server = decodeMcpNamedHttpServerShape(candidate);
  } catch {
    throw new McpNamedHttpServerValidationError("invalid_shape");
  }

  if (!MCP_SERVER_NAME.test(server.name)) {
    throw new McpNamedHttpServerValidationError("invalid_name");
  }
  if (server.name === "t3-code") {
    throw new McpNamedHttpServerValidationError("reserved_name");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(server.endpoint);
  } catch {
    throw new McpNamedHttpServerValidationError("invalid_endpoint");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new McpNamedHttpServerValidationError("unsupported_endpoint_scheme");
  }
  if (!LOOPBACK_HOSTNAMES.has(endpoint.hostname.toLowerCase())) {
    throw new McpNamedHttpServerValidationError("non_loopback_endpoint");
  }
  if (
    !server.authorizationHeader.startsWith("Bearer ") ||
    server.authorizationHeader.slice("Bearer ".length).trim().length === 0
  ) {
    throw new McpNamedHttpServerValidationError("invalid_authorization_header");
  }

  return server;
}

export function mcpServersOf(
  config: McpProviderSessionConfig | undefined,
): ReadonlyArray<McpNamedHttpServer> {
  if (!config) return [];

  const servers: McpNamedHttpServer[] = [
    {
      name: "t3-code",
      endpoint: config.endpoint,
      authorizationHeader: config.authorizationHeader,
    },
  ];
  const names = new Set(["t3-code"]);
  for (const candidate of config.additionalServers ?? []) {
    const server = validateMcpNamedHttpServer(candidate);
    if (names.has(server.name)) {
      throw new McpNamedHttpServerValidationError("duplicate_name");
    }
    names.add(server.name);
    servers.push(server);
  }
  return servers;
}

const sessionsByThread = new Map<ThreadId, McpProviderSessionConfig>();

export function setMcpProviderSession(config: McpProviderSessionConfig): void {
  sessionsByThread.set(config.threadId, config);
}

export function readMcpProviderSession(threadId: ThreadId): McpProviderSessionConfig | undefined {
  return sessionsByThread.get(threadId);
}

export function clearMcpProviderSession(threadId: ThreadId): void {
  sessionsByThread.delete(threadId);
}

export function clearAllMcpProviderSessions(): void {
  sessionsByThread.clear();
}
