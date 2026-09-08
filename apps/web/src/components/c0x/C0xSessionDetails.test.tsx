import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { MessageId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { C0xSessionDetailsThread } from "~/c0x/sessionDetails";
import type { ChatAttachment, ChatMessage } from "~/types";

import { C0xSessionSummary } from "./C0xSessionDetails";

const createdAt = "2026-09-08T12:00:00.000Z";
let renderer: ReactTestRenderer | null = null;

function attachment(id: string, name: string): ChatAttachment {
  return {
    id,
    mimeType: "application/pdf",
    name,
    sizeBytes: 1_024,
    type: "file",
  } as ChatAttachment;
}

function message(input: {
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly id: string;
  readonly role: "assistant" | "user";
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

function thread(id: string, messages: ReadonlyArray<ChatMessage>): C0xSessionDetailsThread {
  return {
    id: ThreadId.make(id),
    messages,
    activities: [],
  };
}

function renderedText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : renderedText(child)))
    .join(" ");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("C0xSessionSummary", () => {
  it("replaces session resources when the mounted component changes threads", async () => {
    const firstThread = thread("thread-first", [
      message({
        id: "first-message",
        role: "assistant",
        attachments: [attachment("first-output", "first-output.pdf")],
      }),
    ]);
    const secondThread = thread("thread-second", [
      message({
        id: "second-message",
        role: "assistant",
        attachments: [attachment("second-output", "second-output.pdf")],
      }),
    ]);

    await act(() => {
      renderer = create(<C0xSessionSummary thread={firstThread} />);
    });
    expect(renderedText(renderer!.root)).toContain("first-output.pdf");

    await act(() => {
      renderer?.update(<C0xSessionSummary thread={secondThread} />);
    });
    const text = renderedText(renderer!.root);
    expect(text).toContain("second-output.pdf");
    expect(text).not.toContain("first-output.pdf");
    expect(renderer!.root.findByProps({ "data-thread-id": "thread-second" })).toBeDefined();
  });

  it("caps compact rows and exposes the real detail actions", async () => {
    const outputs = Array.from({ length: 7 }, (_, index) =>
      attachment(`output-${index + 1}`, `output-${index + 1}.pdf`),
    );
    const sources = Array.from({ length: 4 }, (_, index) =>
      attachment(`source-${index + 1}`, `source-${index + 1}.pdf`),
    );
    const onOpenDetails = vi.fn();
    await act(() => {
      renderer = create(
        <C0xSessionSummary
          thread={thread("thread-caps", [
            message({ id: "outputs", role: "assistant", attachments: outputs }),
            message({ id: "sources", role: "user", attachments: sources }),
          ])}
          onOpenDetails={onOpenDetails}
        />,
      );
    });

    const text = renderedText(renderer!.root);
    expect(text).toContain("output-6.pdf");
    expect(text).not.toContain("output-7.pdf");
    expect(text).toContain("source-3.pdf");
    expect(text).not.toContain("source-4.pdf");
    expect(text).toContain("Show 1 more");
    expect(text).toContain("View all");

    await act(() =>
      renderer!.root.findByType("aside").findAllByType("button").at(-1)?.props.onClick(),
    );
    expect(onOpenDetails).toHaveBeenCalledWith("sources");
  });

  it("dispatches recorded targets and never renders absent add actions", async () => {
    const sourceAttachment = attachment("brief", "brief.pdf");
    const onOpenAttachment = vi.fn();
    const onOpenUrl = vi.fn();
    const onAddSource = vi.fn();
    await act(() => {
      renderer = create(
        <C0xSessionSummary
          thread={thread("thread-actions", [
            message({
              id: "user-sources",
              role: "user",
              text: "[Reference](https://example.com/reference)",
              attachments: [sourceAttachment],
            }),
          ])}
          onAddSource={onAddSource}
          onOpenAttachment={onOpenAttachment}
          onOpenUrl={onOpenUrl}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({ "aria-label": "Add output" })).toHaveLength(0);
    const addSource = renderer!.root.findByProps({ "aria-label": "Add source" });
    const openAttachment = renderer!.root.findByProps({ "aria-label": "Open brief.pdf" });
    const openUrl = renderer!.root.findByProps({ "aria-label": "Open Reference" });

    await act(() => addSource.props.onClick());
    await act(() => openAttachment.props.onClick());
    await act(() => openUrl.props.onClick());
    expect(onAddSource).toHaveBeenCalledOnce();
    expect(onOpenAttachment).toHaveBeenCalledWith(sourceAttachment);
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.com/reference");
  });
});
