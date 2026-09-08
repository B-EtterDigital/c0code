import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ComposerThreadDraftState } from "../composerDraftStore";
import { createMemoryStorage } from "../lib/storage";

const threadRef = scopeThreadRef(
  EnvironmentId.make("fluid-queue-environment"),
  ThreadId.make("fluid-queue-thread"),
);
const threadKey = "fluid-queue-environment:fluid-queue-thread";

function draft(prompt = "Follow up after the current turn"): ComposerThreadDraftState {
  const dataUrl = "data:image/png;base64,aW1hZ2U=";
  return {
    prompt,
    images: [
      {
        type: "image",
        id: "image-1",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 5,
        previewUrl: dataUrl,
        file: new File(["image"], "diagram.png", { type: "image/png" }),
      },
    ],
    files: [
      {
        type: "file",
        id: "file-1",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        file: new File(["notes"], "notes.txt", { type: "text/plain" }),
      },
    ],
    nonPersistedImageIds: ["image-1"],
    persistedAttachments: [],
    terminalContexts: [],
    elementContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    modelSelectionByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
  };
}

function sendContext() {
  return {
    providerAvailable: true,
    selectedPromptEffort: "high",
    selectedModelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-test", []),
    selectedProvider: ProviderDriverKind.make("codex"),
    selectedModel: "gpt-test",
    selectedProviderModels: [],
    interactionMode: "default" as const,
    interactionModeEnabled: true,
  };
}

beforeEach(() => {
  vi.resetModules();
  const localStorage = createMemoryStorage();
  vi.stubGlobal("localStorage", localStorage);
  const tails = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", { userAgent: "", locks: {
    request: (name: string, _options: unknown, action: () => Promise<unknown>) => {
      const next = (tails.get(name) ?? Promise.resolve()).then(action);
      tails.set(name, next);
      return next;
    },
  } });
  vi.stubGlobal("window", {
    localStorage,
    addEventListener: vi.fn(),
    __c0xShellEvents: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function enqueue(prompt?: string) {
  const queue = await import("./fluidQueue");
  const entry = await queue.enqueueFluidQueueEntry({
    threadKey,
    threadRef,
    draft: draft(prompt),
    runtimeMode: "full-access",
    sendContext: sendContext(),
  });
  expect(entry).not.toBeNull();
  return { queue, entry: entry! };
}

describe("fluid steering queue", () => {
  it('retains queue state when cross-window locking is unavailable', async () => {
    const { queue, entry } = await enqueue();
    vi.stubGlobal('navigator', { userAgent: '' });
    const dispatch = vi.fn(async () => true);
    expect(await queue.dispatchFluidQueueEntry({ threadKey, mode: 'automatic', dispatch })).toBe('busy');
    expect(dispatch).not.toHaveBeenCalled();
    expect(queue.readFluidQueueState().entries[0]?.id).toBe(entry.id);
    expect(await queue.removeFluidQueueEntry(threadKey, entry.id)).toBe(false);
  });
  it("persists a complete queued draft and keeps it recoverable when queuing is off", async () => {
    const { queue, entry } = await enqueue("Ship this next\nwith context");

    expect(queue.fluidQueueEntryLabel(entry)).toBe("Ship this next with context");
    expect(entry.draft.images[0]?.dataUrl).toBe("data:image/png;base64,aW1hZ2U=");
    expect(entry.draft.files[0]).toMatchObject({ id: "file-1", name: "notes.txt" });
    expect(await queue.setFluidQueueEnabled(false)).toBe(true);

    const persisted = queue.readFluidQueueState();
    expect(persisted.enabled).toBe(false);
    expect(persisted.entries.map((queued) => queued.id)).toEqual([entry.id]);
  });

  it("retains an entry after refused dispatch and removes it only after a real start", async () => {
    const { queue, entry } = await enqueue();
    const refused = await queue.dispatchFluidQueueEntry({
      threadKey,
      entryId: entry.id,
      mode: "steer",
      dispatch: async () => false,
    });
    expect(refused).toBe("refused");
    expect(queue.readFluidQueueState().entries).toHaveLength(1);

    const started = await queue.dispatchFluidQueueEntry({
      threadKey,
      entryId: entry.id,
      mode: "steer",
      dispatch: async () => true,
    });
    expect(started).toBe("started");
    expect(queue.readFluidQueueState().entries).toHaveLength(0);
  });

  it("admits only one dispatcher for two mounted composers", async () => {
    const { queue } = await enqueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatch = vi.fn(async () => {
      await gate;
      return true;
    });

    const first = queue.dispatchFluidQueueEntry({
      threadKey,
      mode: "automatic",
      dispatch,
    });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const second = queue.dispatchFluidQueueEntry({
      threadKey,
      mode: "automatic",
      dispatch,
    });
    release();
    expect(await first).toBe("started");
    expect(await second).toBe("busy");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("drains sequentially only after the accepted turn runs and becomes ready", async () => {
    const { queue, entry: first } = await enqueue("first queued turn");
    const second = await queue.enqueueFluidQueueEntry({
      threadKey,
      threadRef,
      draft: draft("second queued turn"),
      runtimeMode: "full-access",
      sendContext: sendContext(),
    });
    expect(second).not.toBeNull();

    expect(
      await queue.dispatchFluidQueueEntry({
        threadKey,
        entryId: first.id,
        mode: "automatic",
        dispatch: async () => true,
      }),
    ).toBe("started");
    expect(queue.readFluidQueueState().entries.map((entry) => entry.id)).toEqual([second!.id]);
    expect(
      await queue.dispatchFluidQueueEntry({
        threadKey,
        mode: "automatic",
        dispatch: async () => true,
      }),
    ).toBe("busy");

    const requestedAt = "2026-09-09T00:00:01.000Z";
    await queue.recordFluidQueueTurnRequest(threadKey, first.id, requestedAt);
    const running = { turnId: TurnId.make("accepted-queued-turn"), requestedAt,
      state: "running" as const, startedAt: requestedAt, completedAt: null, assistantMessageId: null };
    await queue.reconcileFluidQueuePhase(threadKey, running);
    // A second window still showing the previous completed turn cannot release this claim.
    await queue.reconcileFluidQueuePhase(threadKey, { ...running, requestedAt: "2026-09-09T00:00:00.000Z",
      state: "completed", completedAt: requestedAt });
    expect(queue.readFluidQueueState().claimsByThreadKey[threadKey]).toBeDefined();
    await queue.reconcileFluidQueuePhase(threadKey, { ...running, state: "completed", completedAt: "2026-09-09T00:00:02.000Z" });
    expect(
      await queue.dispatchFluidQueueEntry({
        threadKey,
        mode: "automatic",
        dispatch: async () => true,
      }),
    ).toBe("started");
    expect(queue.readFluidQueueState().entries).toHaveLength(0);
  });

  it("observes queue removal from another window", async () => {
    const { queue } = await enqueue();
    localStorage.removeItem(queue.FLUID_QUEUE_STORAGE_KEY);
    expect(queue.readFluidQueueState()).toMatchObject({ enabled: true, entries: [] });
  });

  it("refuses Edit without changing an occupied composer draft", async () => {
    const { queue, entry } = await enqueue("queued copy");
    const { useComposerDraftStore } = await import("../composerDraftStore");
    useComposerDraftStore.getState().setPrompt(threadRef, "new unsent text");

    expect(await queue.restoreFluidQueueEntry(threadRef, entry)).toBe("occupied");
    expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe(
      "new unsent text",
    );
    expect(queue.readFluidQueueState().entries).toHaveLength(1);
  });
});
