import { OpenCodeSettings, ProviderDriverKind, ProviderInstanceId, resolveProviderInstanceEnabled, type ProviderInstanceConfig } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AgentSessionScanError } from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as ProcessRunner from "../processRunner.ts";
import type { AgentSessionRecentThread } from "./AgentSessionScanner.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const timestamp = (value: unknown) => DateTime.formatIso(Option.getOrElse(DateTime.make(typeof value === "number" ? value : 0), () => DateTime.makeUnsafe(0)));

/** Keep the original OpenCode session and complete provider/model route. No provider turn is sent. */
export function parseOpenCodeImport(value: unknown, sessionId: string, workspaceRoot: string): AgentSessionRecentThread {
  const exported = record(value);
  const info = record(exported.info);
  if (info.id !== sessionId || !text(info.directory) || normalizeProjectPathForComparison(text(info.directory)) !== normalizeProjectPathForComparison(workspaceRoot)) {
    throw new Error("The selected OpenCode session does not belong to this project.");
  }
  const messages: { role: "user" | "assistant"; text: string; createdAt: string }[] = [];
  let model: string | null = null;
  for (const entry of Array.isArray(exported.messages) ? exported.messages : []) {
    const item = record(entry);
    const message = record(item.info);
    const selected = record(message.model);
    const providerId = text(message.providerID) || text(selected.providerID);
    const modelId = text(message.modelID) || text(selected.modelID);
    if (providerId && modelId) model = `${providerId}/${modelId}`;
    const body = (Array.isArray(item.parts) ? item.parts : []).map(record).filter((part) => part.type === "text")
      .map((part) => text(part.text)).filter(Boolean).join("\n");
    if (body && (message.role === "user" || message.role === "assistant")) messages.push({
      role: message.role, text: body, createdAt: timestamp(record(message.time).created),
    });
  }
  if (messages.length === 0) throw new Error("The selected OpenCode session has no conversation to resume.");
  const instanceId = ProviderInstanceId.make("opencode");
  const time = record(info.time);
  return { _tag: "Importable", thread: { source: "opencode", providerInstanceId: instanceId, providerSessionId: sessionId,
    title: text(info.title) || "OpenCode session", model, createdAt: timestamp(time.created), updatedAt: timestamp(time.updated), messages },
    source: { provider: "opencode", providerInstanceId: instanceId, providerSessionId: sessionId,
      filePath: `opencode:session:${sessionId}`, size: Buffer.byteLength(JSON.stringify(value)), mtimeMs: typeof time.updated === "number" ? time.updated : null,
      device: 0, inode: null, birthtimeMs: null } };
}

export const readOpenCodeSession = Effect.fn("readOpenCodeSession")(function* (sessionId: string, workspaceRoot: string) {
  const failure = (cause: unknown) => new AgentSessionScanError({ operation: "read-projects", cause });
  if (!/^ses_[a-zA-Z0-9]+$/.test(sessionId)) return yield* Effect.fail(failure("Invalid OpenCode session id."));
  const service = yield* Effect.serviceOption(ServerSettingsService);
  if (Option.isNone(service)) return yield* Effect.fail(failure("OpenCode settings are unavailable."));
  const settings = yield* service.value.getSettings.pipe(Effect.mapError(failure));
  const instance: ProviderInstanceConfig = settings.providerInstances[ProviderInstanceId.make("opencode")] ?? { driver: ProviderDriverKind.make("opencode"), config: settings.providers.opencode };
  if (instance.driver !== "opencode" || !resolveProviderInstanceEnabled(instance)) return yield* Effect.fail(failure("Enable OpenCode in Your Accounts before resuming this session."));
  const config = yield* Schema.decodeUnknownEffect(OpenCodeSettings)(instance.config ?? {}).pipe(Effect.mapError(failure));
  if (config.serverUrl.trim()) return yield* Effect.fail(failure("This session belongs to the local OpenCode CLI. Choose its local account in setup."));
  const runner = yield* ProcessRunner.make();
  const output = yield* runner.run({ command: config.binaryPath, args: ["export", sessionId],
    cwd: workspaceRoot, env: mergeProviderInstanceEnvironment(instance.environment), timeout: "20 seconds",
    maxOutputBytes: 32 * 1024 * 1024, outputMode: "error" }).pipe(Effect.mapError(failure));
  if (output.code !== 0) return yield* Effect.fail(failure(`OpenCode export stopped with exit code ${output.code}.`));
  const value = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(output.stdout).pipe(Effect.mapError(failure));
  return yield* Effect.try({ try: () => parseOpenCodeImport(value, sessionId, workspaceRoot), catch: failure });
});
