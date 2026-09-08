import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import type { ChatAttachment, ChatMessage, Thread } from "../types";

export type SessionDetailIcon = "file" | "image" | "unknown" | "web";

export type SessionDetailOpenTarget =
  | { readonly kind: "attachment"; readonly attachment: ChatAttachment }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "url"; readonly url: string };

export type SessionDetailProvenance =
  | { readonly kind: "assistant-message"; readonly messageId: string }
  | {
      readonly activityIds: ReadonlyArray<string>;
      readonly action: "access" | "read";
      readonly callId?: string;
      readonly kind: "tool";
      readonly provider?: string;
      readonly tool?: string;
    }
  | { readonly kind: "user-message"; readonly messageId: string };

export interface SessionDetailEntry {
  readonly icon: SessionDetailIcon;
  readonly id: string;
  readonly location: string;
  readonly provenance: SessionDetailProvenance;
  readonly target?: SessionDetailOpenTarget;
  readonly title: string;
}

export interface SessionToolUsage {
  readonly count: number;
  readonly tool: string;
}

export interface SessionToolUsageGroup {
  readonly count: number;
  readonly provider: string;
  readonly tools: ReadonlyArray<SessionToolUsage>;
}

export interface C0xSessionDetailsModel {
  readonly outputs: ReadonlyArray<SessionDetailEntry>;
  readonly sources: ReadonlyArray<SessionDetailEntry>;
  readonly toolUsage: ReadonlyArray<SessionToolUsageGroup>;
}

export type C0xSessionDetailsThread = Pick<Thread, "activities" | "id" | "messages">;

export interface C0xSessionDetailsInput {
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity> | undefined;
  readonly messages?: ReadonlyArray<ChatMessage> | undefined;
  readonly thread: C0xSessionDetailsThread;
}

interface RecordedToolCall {
  readonly activities: OrchestrationThreadActivity[];
  readonly callId?: string;
}

const MARKDOWN_URL_PATTERN =
  /\[([^\]]+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/giu;
const BARE_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const LIFECYCLE_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);
const FILE_PATH_KEYS = new Set([
  "file",
  "file_path",
  "filePath",
  "filename",
  "imagePath",
  "path",
  "relativePath",
]);
const URL_KEYS = new Set(["href", "pageUrl", "uri", "url"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizedToolLabel(value: string): string {
  return value
    .replace(/\s+(?:complete|completed|started)$/iu, "")
    .replace(/[_-]+/gu, " ")
    .trim();
}

function toolPayload(activity: OrchestrationThreadActivity): Record<string, unknown> | undefined {
  return asRecord(activity.payload);
}

function toolData(activity: OrchestrationThreadActivity): Record<string, unknown> | undefined {
  return asRecord(toolPayload(activity)?.data);
}

function toolCallId(activity: OrchestrationThreadActivity): string | undefined {
  const payload = toolPayload(activity);
  return nonEmptyString(payload?.toolCallId) ?? nonEmptyString(asRecord(payload?.data)?.toolCallId);
}

function toolItemType(activity: OrchestrationThreadActivity): string | undefined {
  return nonEmptyString(toolPayload(activity)?.itemType);
}

function toolName(activity: OrchestrationThreadActivity): string | undefined {
  const payload = toolPayload(activity);
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const candidate =
    nonEmptyString(item?.tool) ??
    nonEmptyString(data?.toolName) ??
    nonEmptyString(payload?.title) ??
    nonEmptyString(activity.summary) ??
    toolItemType(activity);
  return candidate ? normalizedToolLabel(candidate) : undefined;
}

function toolProvider(activity: OrchestrationThreadActivity): string | undefined {
  const payload = toolPayload(activity);
  const data = asRecord(payload?.data);
  const source = asRecord(payload?.toolSource);
  return (
    nonEmptyString(source?.name) ??
    nonEmptyString(asRecord(data?.item)?.server) ??
    nonEmptyString(data?.server)
  );
}

function isRecordedToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (LIFECYCLE_KINDS.has(activity.kind)) return true;
  if (activity.tone !== "tool") return false;
  const payload = toolPayload(activity);
  return (
    payload !== undefined && (payload.itemType !== undefined || payload.toolCallId !== undefined)
  );
}

function lifecycleSignature(activity: OrchestrationThreadActivity): string {
  return [
    activity.turnId ?? "no-turn",
    toolItemType(activity) ?? "",
    toolName(activity) ?? "unknown",
  ]
    .join("\u001f")
    .toLowerCase();
}

function appendActivity(call: RecordedToolCall, activity: OrchestrationThreadActivity): void {
  call.activities.push(activity);
}

function recordedToolCalls(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<RecordedToolCall> {
  const calls: RecordedToolCall[] = [];
  const byCallId = new Map<string, RecordedToolCall>();
  const openIdlessBySignature = new Map<string, RecordedToolCall>();
  const seenEventIds = new Set<string>();

  for (const activity of activities) {
    const eventId = String(activity.id);
    if (seenEventIds.has(eventId) || !isRecordedToolActivity(activity)) continue;
    seenEventIds.add(eventId);

    const callId = toolCallId(activity);
    if (callId) {
      const scopedCallId = `${activity.turnId ?? "no-turn"}\u001f${callId}`;
      const existing = byCallId.get(scopedCallId);
      if (existing) {
        appendActivity(existing, activity);
      } else {
        const call: RecordedToolCall = { activities: [activity], callId };
        calls.push(call);
        byCallId.set(scopedCallId, call);
      }
      continue;
    }

    const signature = lifecycleSignature(activity);
    const openCall = openIdlessBySignature.get(signature);
    if (activity.kind === "tool.started") {
      const call: RecordedToolCall = { activities: [activity] };
      calls.push(call);
      openIdlessBySignature.set(signature, call);
    } else if (openCall) {
      appendActivity(openCall, activity);
      if (activity.kind === "tool.completed") openIdlessBySignature.delete(signature);
    } else {
      const call: RecordedToolCall = { activities: [activity] };
      calls.push(call);
      if (activity.kind === "tool.updated") openIdlessBySignature.set(signature, call);
    }
  }

  return calls;
}

function lastDefined<T>(values: ReadonlyArray<T | undefined>): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== undefined) return values[index];
  }
  return undefined;
}

function trimUrlPunctuation(value: string): string {
  let result = value.replace(/[.,!?;:]+$/u, "");
  while (
    result.endsWith(")") &&
    (result.match(/\(/gu)?.length ?? 0) < (result.match(/\)/gu)?.length ?? 0)
  ) {
    result = result.slice(0, -1);
  }
  return result;
}

function normalizedHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(trimUrlPunctuation(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function urlTitle(url: string, suppliedTitle?: string): string {
  const title = suppliedTitle?.replace(/[*_`]/gu, "").trim();
  if (title) return title;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${Math.round(value / 1_024)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function attachmentIcon(attachment: ChatAttachment): SessionDetailIcon {
  if (attachment.type === "image") return "image";
  if (attachment.type === "file") return "file";
  return "unknown";
}

function attachmentLocation(attachment: ChatAttachment): string {
  return `${attachment.mimeType}, ${formatBytes(attachment.sizeBytes)}`;
}

function messageUrls(
  text: string,
): ReadonlyArray<{ readonly title?: string; readonly url: string }> {
  const found: Array<{ title?: string; url: string }> = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(MARKDOWN_URL_PATTERN)) {
    const url = match[2] ? normalizedHttpUrl(match[2]) : undefined;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    found.push({ url, ...(nonEmptyString(match[1]) ? { title: match[1]!.trim() } : {}) });
  }
  for (const match of text.matchAll(BARE_URL_PATTERN)) {
    const url = normalizedHttpUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    found.push({ url });
  }

  return found;
}

function messageEntries(
  messages: ReadonlyArray<ChatMessage>,
): Pick<C0xSessionDetailsModel, "outputs" | "sources"> {
  const outputs: SessionDetailEntry[] = [];
  const sources: SessionDetailEntry[] = [];

  for (const message of messages) {
    const messageId = String(message.id);
    if (message.role === "user") {
      for (const attachment of message.attachments ?? []) {
        sources.push({
          icon: attachmentIcon(attachment),
          id: `user:${messageId}:attachment:${attachment.id}`,
          location: attachmentLocation(attachment),
          provenance: { kind: "user-message", messageId },
          target: { kind: "attachment", attachment },
          title: attachment.name,
        });
      }
      for (const link of messageUrls(message.text)) {
        sources.push({
          icon: "web",
          id: `user:${messageId}:url:${link.url}`,
          location: link.url,
          provenance: { kind: "user-message", messageId },
          target: { kind: "url", url: link.url },
          title: urlTitle(link.url, link.title),
        });
      }
    } else if (message.role === "assistant") {
      for (const attachment of message.attachments ?? []) {
        outputs.push({
          icon: attachmentIcon(attachment),
          id: `assistant:${messageId}:attachment:${attachment.id}`,
          location: attachmentLocation(attachment),
          provenance: { kind: "assistant-message", messageId },
          target: { kind: "attachment", attachment },
          title: attachment.name,
        });
      }
    }
  }

  return { outputs, sources };
}

function parseJsonContainer(value: unknown): unknown {
  if (typeof value !== "string" || !/^(?:\{|\[)/u.test(value.trim())) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function collectKeyedStrings(
  value: unknown,
  keys: ReadonlySet<string>,
  target: string[],
  depth = 0,
): void {
  if (depth > 5 || target.length >= 24) return;
  const parsed = parseJsonContainer(value);
  if (Array.isArray(parsed)) {
    for (const entry of parsed) collectKeyedStrings(entry, keys, target, depth + 1);
    return;
  }
  const record = asRecord(parsed);
  if (!record) return;
  for (const [key, entry] of Object.entries(record)) {
    if (keys.has(key)) {
      const candidate = nonEmptyString(entry);
      if (candidate) target.push(candidate);
    }
    if (
      typeof entry === "object" ||
      (typeof entry === "string" && /^(?:\{|\[)/u.test(entry.trim()))
    ) {
      collectKeyedStrings(entry, keys, target, depth + 1);
    }
  }
}

function callInputs(call: RecordedToolCall): ReadonlyArray<unknown> {
  const inputs: unknown[] = [];
  for (const activity of call.activities) {
    const payload = toolPayload(activity);
    const data = asRecord(payload?.data);
    const item = asRecord(data?.item);
    inputs.push(
      payload?.input,
      payload?.arguments,
      data?.input,
      data?.rawInput,
      data?.arguments,
      data?.files,
      data?.locations,
      data?.imagePath ? { imagePath: data.imagePath } : undefined,
      item?.input,
      item?.arguments,
      payload?.toolIcon,
      asRecord(payload?.toolSource)?.icon,
    );
  }
  return inputs;
}

function isFileReadCall(call: RecordedToolCall): boolean {
  return call.activities.some((activity) => {
    const payload = toolPayload(activity);
    const data = toolData(activity);
    const name = toolName(activity)
      ?.toLowerCase()
      .replace(/[\s.-]+/gu, "_");
    const kind = nonEmptyString(data?.kind)?.toLowerCase();
    return (
      toolItemType(activity) === "image_view" ||
      nonEmptyString(payload?.requestKind) === "file-read" ||
      kind === "read" ||
      name === "read" ||
      name === "read_file" ||
      name === "readfile" ||
      name === "view_image" ||
      name === "open_file"
    );
  });
}

function likelyFilePath(value: string): boolean {
  return (
    !/[\r\n]/u.test(value) &&
    normalizedHttpUrl(value) === undefined &&
    (/^(?:\.{0,2}[\\/]|~[\\/]|[A-Za-z]:[\\/])/u.test(value) ||
      value.includes("/") ||
      value.includes("\\") ||
      /\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?$/u.test(value))
  );
}

function basename(path: string): string {
  const withoutPosition = path.replace(/:\d+(?::\d+)?$/u, "");
  return withoutPosition.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

function toolProvenance(
  call: RecordedToolCall,
  action: "access" | "read",
): SessionDetailProvenance {
  const provider = lastDefined(call.activities.map(toolProvider));
  const tool = lastDefined(call.activities.map(toolName));
  return {
    activityIds: call.activities.map((activity) => String(activity.id)),
    action,
    ...(call.callId ? { callId: call.callId } : {}),
    kind: "tool",
    ...(provider ? { provider } : {}),
    ...(tool ? { tool } : {}),
  };
}

function toolSourceEntries(calls: ReadonlyArray<RecordedToolCall>): SessionDetailEntry[] {
  const sources: SessionDetailEntry[] = [];
  for (const [callIndex, call] of calls.entries()) {
    const keyedPaths: string[] = [];
    const keyedUrls: string[] = [];
    for (const input of callInputs(call)) {
      collectKeyedStrings(input, FILE_PATH_KEYS, keyedPaths);
      collectKeyedStrings(input, URL_KEYS, keyedUrls);
    }
    if (isFileReadCall(call)) {
      const detailCandidates = call.activities.flatMap((activity) => {
        const detail = nonEmptyString(toolPayload(activity)?.detail);
        return detail ? [detail] : [];
      });
      const paths = new Set([...keyedPaths, ...detailCandidates].filter(likelyFilePath));
      for (const path of paths) {
        sources.push({
          icon: /\.(?:avif|gif|jpe?g|png|svg|webp)(?::\d+(?::\d+)?)?$/iu.test(path)
            ? "image"
            : "file",
          id: `tool:${call.callId ?? callIndex}:file:${path}`,
          location: path,
          provenance: toolProvenance(call, "read"),
          target: { kind: "file", path },
          title: basename(path),
        });
      }
    }
    const urls = new Set(keyedUrls.flatMap((value) => normalizedHttpUrl(value) ?? []));
    for (const url of urls) {
      sources.push({
        icon: "web",
        id: `tool:${call.callId ?? callIndex}:url:${url}`,
        location: url,
        provenance: toolProvenance(call, "access"),
        target: { kind: "url", url },
        title: urlTitle(url),
      });
    }
  }
  return sources;
}

function toolUsageGroups(
  calls: ReadonlyArray<RecordedToolCall>,
): ReadonlyArray<SessionToolUsageGroup> {
  const counts = new Map<string, Map<string, number>>();
  for (const call of calls) {
    const provider = lastDefined(call.activities.map(toolProvider)) ?? "Unknown provider";
    const tool = lastDefined(call.activities.map(toolName)) ?? "Unknown tool";
    const tools = counts.get(provider) ?? new Map<string, number>();
    tools.set(tool, (tools.get(tool) ?? 0) + 1);
    counts.set(provider, tools);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, tools]) => {
      const usage = [...tools.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tool, count]) => ({ count, tool }));
      return {
        count: usage.reduce((total, entry) => total + entry.count, 0),
        provider,
        tools: usage,
      };
    });
}

export function sessionDetailProvenanceLabel(provenance: SessionDetailProvenance): string {
  if (provenance.kind === "user-message") return "Supplied in your message";
  if (provenance.kind === "assistant-message") return "Output from assistant response";
  const verb = provenance.action === "read" ? "Read" : "Accessed";
  if (provenance.provider && provenance.tool) {
    return `${verb} by ${provenance.provider} using ${provenance.tool}`;
  }
  if (provenance.tool) return `${verb} using ${provenance.tool}`;
  if (provenance.provider) return `${verb} by ${provenance.provider}`;
  return "Recorded tool source";
}

export function deriveC0xSessionDetails({
  activities,
  messages,
  thread,
}: C0xSessionDetailsInput): C0xSessionDetailsModel {
  const currentMessages = messages ?? thread.messages;
  const currentActivities = activities ?? thread.activities;
  const messageModel = messageEntries(currentMessages);
  const calls = recordedToolCalls(currentActivities);
  return {
    outputs: messageModel.outputs,
    sources: [...messageModel.sources, ...toolSourceEntries(calls)],
    toolUsage: toolUsageGroups(calls),
  };
}
