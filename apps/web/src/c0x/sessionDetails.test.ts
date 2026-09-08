import {
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ChatAttachment, ChatMessage } from "../types";
import {
  deriveC0xSessionDetails,
  sessionDetailProvenanceLabel,
  type C0xSessionDetailsThread,
} from "./sessionDetails";

const createdAt = "2026-09-08T12:00:00.000Z";

function fileAttachment(id: string, name: string): ChatAttachment {
  return {
    id,
    mimeType: "application/pdf",
    name,
    sizeBytes: 2_048,
    type: "file",
  } as ChatAttachment;
}

function message(input: {
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly id: string;
  readonly role: ChatMessage["role"];
  readonly text?: string;
}): ChatMessage {
  return {
    id: MessageId.make(input.id),
    role: input.role,
    text: input.text ?? "",
    ...(input.attachments ? { attachments: input.attachments } : {}),
    turnId: null,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
  };
}

function activity(input: {
  readonly id: string;
  readonly kind?: string;
  readonly payload?: unknown;
  readonly summary?: string;
  readonly turnId?: string | null;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: "tool",
    kind: input.kind ?? "tool.completed",
    summary: input.summary ?? "Tool",
    payload: input.payload ?? null,
    turnId: input.turnId ? TurnId.make(input.turnId) : null,
    createdAt,
  };
}

function thread(
  id: string,
  messages: ReadonlyArray<ChatMessage>,
  activities: ReadonlyArray<OrchestrationThreadActivity> = [],
): C0xSessionDetailsThread {
  return {
    id: ThreadId.make(id),
    messages,
    activities,
  };
}

describe("deriveC0xSessionDetails", () => {
  it("uses user links and attachments as sources and only assistant attachments as outputs", () => {
    const userFile = fileAttachment("user-file", "brief.pdf");
    const assistantFile = fileAttachment("assistant-file", "result.pdf");
    const model = deriveC0xSessionDetails({
      thread: thread("thread-resources", [
        message({
          id: "message-user",
          role: "user",
          text: "Use [the API guide](https://example.com/guide) and https://docs.example.org/start.",
          attachments: [userFile],
        }),
        message({
          id: "message-assistant",
          role: "assistant",
          text: "I also mentioned https://not-a-source.example/ and created the attachment.",
          attachments: [assistantFile],
        }),
      ]),
    });

    expect(model.sources.map((entry) => entry.title)).toEqual([
      "brief.pdf",
      "the API guide",
      "docs.example.org",
    ]);
    expect(model.outputs.map((entry) => entry.title)).toEqual(["result.pdf"]);
    expect(model.sources.map((entry) => entry.location)).not.toContain(
      "https://not-a-source.example/",
    );
  });

  it("counts one actual call across duplicate lifecycle events and keeps its read source once", () => {
    const activities = [
      activity({
        id: "read-start",
        kind: "tool.started",
        turnId: "turn-1",
        summary: "Read File started",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          toolCallId: "call-read",
          toolSource: { key: "filesystem", kind: "integration", name: "Filesystem" },
          data: { kind: "read", input: { file_path: "src/session.ts" } },
        },
      }),
      activity({
        id: "read-update",
        kind: "tool.updated",
        turnId: "turn-1",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          toolCallId: "call-read",
          data: { kind: "read", input: { file_path: "src/session.ts" } },
        },
      }),
      activity({
        id: "read-complete",
        kind: "tool.completed",
        turnId: "turn-1",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          toolCallId: "call-read",
          toolSource: { key: "filesystem", kind: "integration", name: "Filesystem" },
          data: { kind: "read", files: [{ path: "src/session.ts" }] },
        },
      }),
      activity({
        id: "read-complete",
        kind: "tool.completed",
        turnId: "turn-1",
        summary: "Read File",
        payload: { itemType: "dynamic_tool_call", toolCallId: "call-read" },
      }),
    ];
    const model = deriveC0xSessionDetails({
      thread: thread("thread-tools", [], activities),
    });

    expect(model.toolUsage).toEqual([
      {
        count: 1,
        provider: "Filesystem",
        tools: [{ count: 1, tool: "Read File" }],
      },
    ]);
    expect(model.sources).toHaveLength(1);
    expect(model.sources[0]).toMatchObject({ location: "src/session.ts", title: "session.ts" });
    expect(model.sources[0]?.provenance).toMatchObject({
      activityIds: ["read-start", "read-update", "read-complete"],
      action: "read",
      callId: "call-read",
      kind: "tool",
      provider: "Filesystem",
      tool: "Read File",
    });
  });

  it("scopes reused call IDs by turn and counts idless completions independently", () => {
    const activities = [
      activity({
        id: "same-id-turn-one",
        turnId: "turn-1",
        summary: "Search web",
        payload: { itemType: "web_search", title: "Search web", toolCallId: "same-id" },
      }),
      activity({
        id: "same-id-turn-two",
        turnId: "turn-2",
        summary: "Search web",
        payload: { itemType: "web_search", title: "Search web", toolCallId: "same-id" },
      }),
      activity({
        id: "idless-one",
        turnId: "turn-2",
        summary: "Open page",
        payload: { itemType: "web_search", title: "Open page" },
      }),
      activity({
        id: "idless-two",
        turnId: "turn-2",
        summary: "Open page",
        payload: { itemType: "web_search", title: "Open page" },
      }),
    ];
    const model = deriveC0xSessionDetails({
      thread: thread("thread-call-identity", [], activities),
    });

    expect(model.toolUsage).toEqual([
      {
        count: 4,
        provider: "Unknown provider",
        tools: [
          { count: 2, tool: "Open page" },
          { count: 2, tool: "Search web" },
        ],
      },
    ]);
  });

  it("counts web tools only from recorded activities and records only structured page URLs", () => {
    const model = deriveC0xSessionDetails({
      thread: thread(
        "thread-web",
        [message({ id: "assistant-url", role: "assistant", text: "https://prose.example/" })],
        [
          activity({
            id: "web-open",
            summary: "Open page",
            payload: {
              itemType: "web_search",
              title: "Open page",
              toolCallId: "web-call",
              toolIcon: { _tag: "website", pageUrl: "https://recorded.example/page" },
            },
          }),
        ],
      ),
    });

    expect(model.toolUsage[0]?.count).toBe(1);
    expect(model.sources.map((entry) => entry.location)).toEqual(["https://recorded.example/page"]);
    expect(model.sources[0]?.provenance).toMatchObject({ action: "access", kind: "tool" });
  });

  it("survives malformed payloads and leaves missing tool provenance unattributed", () => {
    const malformed = [
      activity({ id: "null-payload", payload: null }),
      activity({ id: "array-payload", payload: [] }),
      activity({ id: "string-payload", payload: "read /not/a/record" }),
      activity({
        id: "unattributed-read",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          data: { kind: "read", input: { path: "src/known.ts" } },
        },
      }),
    ];
    const model = deriveC0xSessionDetails({
      thread: thread("thread-malformed", [], malformed),
    });

    expect(model.sources).toHaveLength(1);
    expect(model.sources[0]?.location).toBe("src/known.ts");
    expect(model.sources[0]?.provenance).not.toHaveProperty("provider");
    expect(sessionDetailProvenanceLabel(model.sources[0]!.provenance)).toBe("Read using Read File");
    expect(model.toolUsage.find((group) => group.provider === "Unknown provider")?.count).toBe(4);
  });

  it("does not carry resources across consecutive thread derivations", () => {
    const first = deriveC0xSessionDetails({
      thread: thread("thread-first", [
        message({ id: "first", role: "assistant", attachments: [fileAttachment("a", "a.pdf")] }),
      ]),
    });
    const second = deriveC0xSessionDetails({
      thread: thread("thread-second", [
        message({ id: "second", role: "assistant", attachments: [fileAttachment("b", "b.pdf")] }),
      ]),
    });

    expect(first.outputs.map((entry) => entry.title)).toEqual(["a.pdf"]);
    expect(second.outputs.map((entry) => entry.title)).toEqual(["b.pdf"]);
  });
});
