import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useComposerDraftStore } from "~/composerDraftStore";
import { registerC0xComposer } from "./composer";

const target = scopeThreadRef("c0x-composer-test" as EnvironmentId, ThreadId.make("draft-a"));
const other = scopeThreadRef("c0x-composer-test" as EnvironmentId, ThreadId.make("draft-b"));

beforeEach(() => { vi.stubGlobal("window", {}); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("C0X extension of the original T3 draft", () => {
  it("appends to the addressed real draft once and preserves the other draft", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(target, "Explain");
    store.setPrompt(other, "Keep me");
    const focus = vi.fn();
    const cleanup = registerC0xComposer(target, focus);
    expect(window.__c0xComposer?.insert("@c0cap:node-1")).toBe("inserted");
    expect(window.__c0xComposer?.insert("@c0cap:node-1")).toBe("already-present");
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe("Explain @c0cap:node-1 ");
    expect(useComposerDraftStore.getState().getComposerDraft(other)?.prompt).toBe("Keep me");
    expect(focus).toHaveBeenCalledTimes(1);
    cleanup();
    expect(window.__c0xComposer).toBeUndefined();
  });

  it("does not let an old route cleanup unregister the current route", () => {
    const oldCleanup = registerC0xComposer(target, vi.fn());
    const cleanup = registerC0xComposer(other, vi.fn());
    oldCleanup();
    expect(window.__c0xComposer?.insert("")).toBe("empty");
    expect(Object.keys(window.__c0xComposer ?? {}).sort()).toEqual(["attach", "focus", "insert"]);
    cleanup();
  });

  it("adds a preview and upload file to T3's own draft, without duplicating the image", () => {
    const cleanup = registerC0xComposer(target, vi.fn());
    const image = { name: "c0cap.png", mimeType: "image/png", sizeBytes: 1, dataUrl: "data:image/png;base64,AA==" };
    expect(window.__c0xComposer?.attach([image])).toEqual(["attached"]);
    expect(window.__c0xComposer?.attach([image])).toEqual(["already-present"]);
    const stored = useComposerDraftStore.getState().getComposerDraft(target)?.images ?? [];
    expect(stored.filter((entry) => entry.previewUrl === image.dataUrl)).toHaveLength(1);
    expect(stored.find((entry) => entry.previewUrl === image.dataUrl)?.file.size).toBe(1);
    cleanup();
  });
});
