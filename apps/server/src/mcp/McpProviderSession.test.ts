import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  McpNamedHttpServerValidationError,
  type McpProviderSessionConfig,
  mcpServersOf,
  validateMcpNamedHttpServer,
} from "./McpProviderSession.ts";

const server = (
  overrides: Partial<Record<"name" | "endpoint" | "authorizationHeader", string>> = {},
) => ({
  name: "c0vibe",
  endpoint: "http://127.0.0.1:43124/mcp",
  authorizationHeader: "Bearer scoped-token",
  ...overrides,
});

const session = (additionalServers?: McpProviderSessionConfig["additionalServers"]) => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  endpoint: "http://127.0.0.1:43123/mcp",
  authorizationHeader: "Bearer t3-token",
  ...(additionalServers ? { additionalServers } : {}),
});

describe("validateMcpNamedHttpServer", () => {
  it("accepts HTTP and HTTPS loopback endpoints", () => {
    expect(validateMcpNamedHttpServer(server())).toEqual(server());
    expect(validateMcpNamedHttpServer(server({ endpoint: "https://localhost/mcp" }))).toEqual(
      server({ endpoint: "https://localhost/mcp" }),
    );
    expect(validateMcpNamedHttpServer(server({ endpoint: "http://[::1]:43124/mcp" }))).toEqual(
      server({ endpoint: "http://[::1]:43124/mcp" }),
    );
  });

  it("rejects a remote endpoint", () => {
    expect(() =>
      validateMcpNamedHttpServer(server({ endpoint: "https://example.com/mcp" })),
    ).toThrowError(McpNamedHttpServerValidationError);
  });

  it("rejects invalid and reserved names", () => {
    expect(() => validateMcpNamedHttpServer(server({ name: "C0Vibe" }))).toThrowError(
      McpNamedHttpServerValidationError,
    );
    expect(() => validateMcpNamedHttpServer(server({ name: "t3-code" }))).toThrowError(
      McpNamedHttpServerValidationError,
    );
  });

  it("rejects a non-Bearer authorization header without exposing it", () => {
    const secret = "resolver-secret-that-must-not-appear";
    expect(() =>
      validateMcpNamedHttpServer(server({ authorizationHeader: `Basic ${secret}` })),
    ).toThrowError(McpNamedHttpServerValidationError);
    try {
      validateMcpNamedHttpServer(server({ authorizationHeader: `Basic ${secret}` }));
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("mcpServersOf", () => {
  it("returns t3-code first followed by validated additional servers", () => {
    expect(mcpServersOf(session([server()]))).toEqual([
      {
        name: "t3-code",
        endpoint: "http://127.0.0.1:43123/mcp",
        authorizationHeader: "Bearer t3-token",
      },
      server(),
    ]);
  });

  it("rejects duplicate additional server names", () => {
    expect(() => mcpServersOf(session([server(), server()]))).toThrowError(
      McpNamedHttpServerValidationError,
    );
  });
});
