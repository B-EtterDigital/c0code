import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createMemoryStorage } from "../lib/storage";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it("applies another window's draft while retaining pending typing and the live image File", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const storage = createMemoryStorage();
  const listeners = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage,
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  });
  const { useComposerDraftStore: store, COMPOSER_DRAFT_STORAGE_KEY: key,
    partializeComposerDraftStoreState: partialize } = await import("../composerDraftStore");
  const ref = scopeThreadRef(EnvironmentId.make("sync-test"), ThreadId.make("draft-a"));
  const threadKey = scopedThreadKey(ref);
  store.getState().setPrompt(ref, "saved");
  listeners.get("beforeunload")?.({});
  const baseline = JSON.parse(storage.getItem(key) as string);
  const file = new File(["image"], "pending.png", { type: "image/png" });
  store.getState().addImages(ref, [{ type: "image", id: "pending", name: "pending.png", mimeType: "image/png",
    sizeBytes: file.size, file, previewUrl: "blob:pending" }]);
  store.getState().setPrompt(ref, "typing before debounce");
  const remote = { ...baseline, state: { ...baseline.state, draftsByThreadKey: {
    ...baseline.state.draftsByThreadKey,
    [threadKey]: { ...baseline.state.draftsByThreadKey[threadKey], runtimeMode: "full-access" },
  } } };
  const raw = JSON.stringify(remote);
  storage.setItem(key, raw);
  listeners.get("storage")?.({ key, storageArea: storage, newValue: raw });
  const draft = store.getState().getComposerDraft(ref);
  expect(draft?.prompt).toBe("typing before debounce");
  expect(draft?.runtimeMode).toBe("full-access");
  expect(draft?.images[0]?.file).toBe(file);
  expect(draft?.images.map((image) => image.id)).toContain("pending");
  listeners.get("beforeunload")?.({});
  expect(JSON.parse(storage.getItem(key) as string).state).toEqual(partialize(store.getState()));
});
