import { useEffect } from "react";
import { hydrateImagesFromPersisted, useComposerDraftStore, type ComposerThreadTarget } from "~/composerDraftStore";

export type C0xComposerInsertResult = "inserted" | "already-present" | "empty";
type C0xComposerImage = { dataUrl: string; name: string; mimeType: string; sizeBytes: number };

declare global {
  interface Window {
    __c0xComposer?: {
      insert(text: string): C0xComposerInsertResult;
      attach(images: C0xComposerImage[]): string[];
      focus(): void;
    };
  }
}

/** Draft-only extension: T3 continues to own the editor, persistence and send. */
export function registerC0xComposer(target: ComposerThreadTarget, focus: () => void): () => void {
  const api = {
    insert(text: string): C0xComposerInsertResult {
      if (typeof text !== "string" || !text.trim()) return "empty";
      const store = useComposerDraftStore.getState();
      const draft = store.getComposerDraft(target)?.prompt ?? "";
      if (draft.includes(text)) return "already-present";
      const space = draft.length > 0 && !/\s$/.test(draft) ? " " : "";
      store.setPrompt(target, `${draft}${space}${text} `);
      focus();
      return "inserted";
    },
    attach(images: C0xComposerImage[]): string[] {
      return images.map((image) => {
        if (!image.mimeType.startsWith("image/") || !image.dataUrl.startsWith("data:image/")) return "invalid-data-url";
        const store = useComposerDraftStore.getState();
        if (store.getComposerDraft(target)?.images.some((existing) => existing.previewUrl === image.dataUrl)) return "already-present";
        const id = crypto.randomUUID();
        const hydrated = hydrateImagesFromPersisted([{ ...image, id }]);
        if (hydrated.length !== 1) return "invalid-data-url";
        store.addImages(target, hydrated);
        return useComposerDraftStore.getState().getComposerDraft(target)?.images.some((entry) => entry.id === id)
          ? "attached" : "attachment-limit";
      });
    },
    focus,
  };
  window.__c0xComposer = api;
  return () => {
    if (window.__c0xComposer === api) delete window.__c0xComposer;
  };
}

export function useC0xComposer(target: ComposerThreadTarget, focus: () => void): void {
  useEffect(() => registerC0xComposer(target, focus), [target, focus]);
}
