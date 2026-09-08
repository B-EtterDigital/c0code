import type {
  EnvironmentId,
  ModelSelection,
  ProviderDriverKind,
  ProviderInteractionMode,
  RuntimeMode,
  ScopedThreadRef,
  ServerProvider,
} from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import {
  composerDraftHasUserContent,
  hydrateImagesFromPersisted,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadDraftState,
  type ComposerThreadTarget,
  type PersistedComposerDraftFileAttachment,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../composerDraftStore";
import { postC0xShellEvent } from "./nativeShell";

export const FLUID_QUEUE_STORAGE_KEY = "t3code:c0x-fluid-queue:v1";
export const FLUID_QUEUE_DISPATCH_START_TIMEOUT_MS = 15_000;

const FLUID_QUEUE_VERSION = 1;

type QueueProviderModel = ServerProvider["models"][number];

export interface FluidQueueSendContext {
  providerAvailable: boolean;
  selectedPromptEffort: string | null;
  selectedModelSelection: ModelSelection;
  selectedProvider: ProviderDriverKind;
  selectedModel: string;
  selectedProviderModels: ReadonlyArray<QueueProviderModel>;
  interactionMode: ProviderInteractionMode;
  interactionModeEnabled: boolean;
}

export interface FluidQueueDraft {
  prompt: string;
  images: PersistedComposerImageAttachment[];
  files: PersistedComposerDraftFileAttachment[];
  terminalContexts: ComposerThreadDraftState["terminalContexts"];
  elementContexts: ComposerThreadDraftState["elementContexts"];
  previewAnnotations: ComposerThreadDraftState["previewAnnotations"];
  reviewComments: ComposerThreadDraftState["reviewComments"];
}

export interface FluidQueueEntry {
  id: string;
  threadKey: string;
  threadRef: ScopedThreadRef;
  createdAt: string;
  runtimeMode: RuntimeMode;
  sendContext: FluidQueueSendContext;
  draft: FluidQueueDraft;
}

interface FluidQueueDispatchClaim {
  entryId: string;
  mode: "automatic" | "steer";
  startedAt: number;
  sawRunning: boolean;
}

export interface FluidQueueState {
  version: number;
  revision: number;
  enabled: boolean;
  entries: FluidQueueEntry[];
  claimsByThreadKey: Record<string, FluidQueueDispatchClaim>;
}

export type FluidQueueDispatchResult = "started" | "refused" | "busy" | "empty";
export type FluidQueueRestoreResult = "restored" | "occupied" | "failed";

interface LiveQueueDraft {
  images: ComposerImageAttachment[];
  files: ComposerFileAttachment[];
}

interface QueueLockManager {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T>): Promise<T>;
}

const listeners = new Set<() => void>();
const liveDraftsByEntryId = new Map<string, LiveQueueDraft>();
const EMPTY_STATE: FluidQueueState = {
  version: FLUID_QUEUE_VERSION,
  revision: 0,
  enabled: true,
  entries: [],
  claimsByThreadKey: {},
};

let memoryState = EMPTY_STATE;
let cachedRaw: string | null | undefined;
let cachedState = EMPTY_STATE;
let storageListenerInstalled = false;
let lastReportedInvalidRaw: string | null = null;

function reportQueueError(operation: string, error: unknown): void {
  postC0xShellEvent({
    type: "fluid-queue-error",
    operation,
    message: error instanceof Error ? error.message : String(error),
  });
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch (error) {
    reportQueueError("resolve-storage", error);
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFluidQueueState(value: unknown): value is FluidQueueState {
  if (!isRecord(value)) return false;
  return (
    value.version === FLUID_QUEUE_VERSION &&
    typeof value.revision === "number" &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.threadKey === "string" &&
        isRecord(entry.threadRef) &&
        typeof entry.createdAt === "string" &&
        isRecord(entry.sendContext) &&
        isRecord(entry.draft) &&
        typeof entry.draft.prompt === "string" &&
        Array.isArray(entry.draft.images) &&
        Array.isArray(entry.draft.files),
    ) &&
    isRecord(value.claimsByThreadKey)
  );
}

function parseState(raw: string | null): FluidQueueState {
  if (raw === null) {
    cachedRaw = raw;
    cachedState = EMPTY_STATE;
    memoryState = EMPTY_STATE;
    lastReportedInvalidRaw = null;
    return EMPTY_STATE;
  }
  if (raw === cachedRaw) return cachedState;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isFluidQueueState(parsed)) {
      throw new Error("Stored fluid queue has an unsupported shape.");
    }
    cachedRaw = raw;
    cachedState = parsed;
    memoryState = parsed;
    lastReportedInvalidRaw = null;
    return parsed;
  } catch (error) {
    if (lastReportedInvalidRaw !== raw) {
      lastReportedInvalidRaw = raw;
      reportQueueError("read-storage", error);
    }
    cachedRaw = raw;
    cachedState = EMPTY_STATE;
    return EMPTY_STATE;
  }
}

export function readFluidQueueState(): FluidQueueState {
  const target = storage();
  if (!target) return memoryState;
  try {
    return parseState(target.getItem(FLUID_QUEUE_STORAGE_KEY));
  } catch (error) {
    reportQueueError("read-storage", error);
    return memoryState;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

async function writeState(
  update: (state: FluidQueueState) => Omit<FluidQueueState, "version" | "revision"> | null,
): Promise<FluidQueueState | null> {
  return withDispatchLock('state', async () => {
  const current = readFluidQueueState();
  const updated = update(current);
  if (!updated) return null;
  const next: FluidQueueState = {
    ...updated,
    version: FLUID_QUEUE_VERSION,
    revision: current.revision + 1,
  };
  const target = storage();
  if (!target) {
    reportQueueError('write-storage', new Error('Persistent queue storage is unavailable.'));
    return null;
  }
  if (target) {
    try {
      const raw = JSON.stringify(next);
      target.setItem(FLUID_QUEUE_STORAGE_KEY, raw);
      cachedRaw = raw;
      cachedState = next;
    } catch (error) {
      reportQueueError("write-storage", error);
      return null;
    }
  }
  memoryState = next;
  cachedState = next;
  emit();
  return next;
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (
    !storageListenerInstalled &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    storageListenerInstalled = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== FLUID_QUEUE_STORAGE_KEY) return;
      cachedRaw = undefined;
      readFluidQueueState();
      emit();
    });
  }
  return () => listeners.delete(listener);
}

export function useFluidQueueState(): FluidQueueState {
  return useSyncExternalStore(subscribe, readFluidQueueState, () => EMPTY_STATE);
}

export async function setFluidQueueEnabled(enabled: boolean): Promise<boolean> {
  return Boolean(
    await writeState((state) => ({
      enabled,
      entries: state.entries,
      claimsByThreadKey: state.claimsByThreadKey,
    })),
  );
}

function uniqueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random()}`;
}

function persistedImageFor(
  image: ComposerImageAttachment,
  persisted: ReadonlyArray<PersistedComposerImageAttachment>,
): Promise<PersistedComposerImageAttachment> {
  const existing = persisted.find((attachment) => attachment.id === image.id);
  if (existing) return Promise.resolve(existing);
  if (image.previewUrl.startsWith("data:")) {
    return Promise.resolve({
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: image.previewUrl,
      ...(image.source ? { source: image.source } : {}),
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error(`Could not retain ${image.name}.`)),
    );
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not retain ${image.name}.`));
        return;
      }
      resolve({
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: reader.result,
        ...(image.source ? { source: image.source } : {}),
      });
    });
    reader.readAsDataURL(image.file);
  });
}

function persistedFile(file: ComposerFileAttachment): PersistedComposerDraftFileAttachment {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    ...(file.uploadedAttachmentId && file.uploadEnvironmentId
      ? { attachmentId: file.uploadedAttachmentId, environmentId: file.uploadEnvironmentId }
      : {}),
  };
}

export async function enqueueFluidQueueEntry(input: {
  threadKey: string;
  threadRef: ScopedThreadRef;
  draft: ComposerThreadDraftState;
  runtimeMode: RuntimeMode;
  sendContext: FluidQueueSendContext;
}): Promise<FluidQueueEntry | null> {
  try {
    const entry: FluidQueueEntry = {
      id: uniqueId(),
      threadKey: input.threadKey,
      threadRef: input.threadRef,
      createdAt: new Date().toISOString(),
      runtimeMode: input.runtimeMode,
      sendContext: input.sendContext,
      draft: {
        prompt: input.draft.prompt,
        images: await Promise.all(
          input.draft.images.map((image) =>
            persistedImageFor(image, input.draft.persistedAttachments),
          ),
        ),
        files: input.draft.files.map(persistedFile),
        terminalContexts: input.draft.terminalContexts,
        elementContexts: input.draft.elementContexts,
        previewAnnotations: input.draft.previewAnnotations,
        reviewComments: input.draft.reviewComments,
      },
    };
    liveDraftsByEntryId.set(entry.id, {
      images: [...input.draft.images],
      files: [...input.draft.files],
    });
    const written = await writeState((state) => ({
      enabled: state.enabled,
      entries: [...state.entries, entry],
      claimsByThreadKey: state.claimsByThreadKey,
    }));
    if (!written) liveDraftsByEntryId.delete(entry.id);
    return written ? entry : null;
  } catch (error) {
    reportQueueError("enqueue", error);
    return null;
  }
}

function ids(values: ReadonlyArray<{ id: string }>): string {
  return values.map((value) => value.id).join("\u0000");
}

export function fluidQueueEntryStillMatchesDraft(
  entry: FluidQueueEntry,
  draft: ComposerThreadDraftState | null,
): boolean {
  if (!draft || entry.draft.prompt !== draft.prompt) return false;
  return (
    ids(entry.draft.images) === ids(draft.images) &&
    ids(entry.draft.files) === ids(draft.files) &&
    ids(entry.draft.terminalContexts) === ids(draft.terminalContexts) &&
    ids(entry.draft.elementContexts) === ids(draft.elementContexts) &&
    ids(entry.draft.previewAnnotations) === ids(draft.previewAnnotations) &&
    ids(entry.draft.reviewComments) === ids(draft.reviewComments)
  );
}

export function hydrateFluidQueueEntry(entry: FluidQueueEntry): Omit<
  FluidQueueDraft,
  "images" | "files"
> & {
  images: ComposerImageAttachment[];
  files: ComposerFileAttachment[];
} {
  const live = liveDraftsByEntryId.get(entry.id);
  return {
    ...entry.draft,
    images: live?.images ?? hydrateImagesFromPersisted(entry.draft.images),
    files:
      live?.files ??
      entry.draft.files.map((file) => ({
        type: "file" as const,
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        file: null,
        ...(file.attachmentId && file.environmentId
          ? {
              uploadedAttachmentId: file.attachmentId,
              uploadEnvironmentId: file.environmentId as EnvironmentId,
            }
          : {}),
      })),
  };
}

export async function restoreFluidQueueEntry(
  target: ComposerThreadTarget,
  entry: FluidQueueEntry,
): Promise<FluidQueueRestoreResult> {
  const store = useComposerDraftStore.getState();
  if (composerDraftHasUserContent(store.getComposerDraft(target))) return "occupied";
  try {
    const draft = hydrateFluidQueueEntry(entry);
    store.clearComposerContent(target);
    store.setPrompt(target, draft.prompt);
    store.addImages(target, draft.images);
    store.addFiles(target, draft.files);
    store.setTerminalContexts(target, draft.terminalContexts);
    store.setElementContexts(target, draft.elementContexts);
    store.setPreviewAnnotations(target, draft.previewAnnotations);
    store.setReviewComments(target, draft.reviewComments);
    store.setModelSelection(target, entry.sendContext.selectedModelSelection, {
      explicit: true,
      replaceOptions: true,
    });
    store.setRuntimeMode(target, entry.runtimeMode);
    store.setInteractionMode(target, entry.sendContext.interactionMode);
    await store.syncPersistedAttachments(target, entry.draft.images);
    return "restored";
  } catch (error) {
    reportQueueError("restore", error);
    return "failed";
  }
}

export async function removeFluidQueueEntry(threadKey: string, entryId: string): Promise<boolean> {
  const written = await writeState((state) => state.claimsByThreadKey[threadKey]?.entryId === entryId ? null : ({
    enabled: state.enabled,
    entries: state.entries.filter(
      (entry) => !(entry.threadKey === threadKey && entry.id === entryId),
    ),
    claimsByThreadKey: state.claimsByThreadKey,
  }));
  if (written) liveDraftsByEntryId.delete(entryId);
  return Boolean(written);
}

function lockManager(): QueueLockManager | null {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks && typeof locks.request === "function" ? (locks as QueueLockManager) : null;
}

async function withDispatchLock<T>(threadKey: string, action: () => Promise<T>): Promise<T | null> {
  const manager = lockManager();
  if (!manager) {
    reportQueueError("web-lock", new Error("Cross-window queue locking is unavailable. Your draft has been retained."));
    return null;
  }
  try {
    return await manager.request(
      `t3code:c0x-fluid-queue:${threadKey}`,
      { mode: "exclusive" },
      action,
    );
  } catch (error) {
    reportQueueError("web-lock", error);
    return null;
  }
}

export async function dispatchFluidQueueEntry(input: {
  threadKey: string;
  entryId?: string;
  mode: "automatic" | "steer";
  dispatch: (entry: FluidQueueEntry) => Promise<boolean>;
}): Promise<FluidQueueDispatchResult> {
  const result = await withDispatchLock(input.threadKey, async () => {
    const state = readFluidQueueState();
    if (state.claimsByThreadKey[input.threadKey]) return "busy" as const;
    const entry = state.entries.find(
      (candidate) =>
        candidate.threadKey === input.threadKey &&
        (input.entryId === undefined || candidate.id === input.entryId),
    );
    if (!entry) return "empty" as const;
    const claimed = await writeState((current) => current.claimsByThreadKey[input.threadKey] ? null : ({
      enabled: current.enabled,
      entries: current.entries,
      claimsByThreadKey: {
        ...current.claimsByThreadKey,
        [input.threadKey]: {
          entryId: entry.id,
          mode: input.mode,
          startedAt: Date.now(),
          sawRunning: input.mode === "steer",
        },
      },
    }));
    if (!claimed) return "refused" as const;

    let started = false;
    try {
      started = await input.dispatch(entry);
    } catch (error) {
      reportQueueError(input.mode === "steer" ? "steer" : "automatic-dispatch", error);
    }

    const finished = await writeState((current) => {
      const claims = { ...current.claimsByThreadKey };
      if (!started || input.mode === "steer") delete claims[input.threadKey];
      return {
        enabled: current.enabled,
        entries: started
          ? current.entries.filter((candidate) => candidate.id !== entry.id)
          : current.entries,
        claimsByThreadKey: claims,
      };
    });
    if (!finished) return "refused" as const;
    if (started) liveDraftsByEntryId.delete(entry.id);
    return started ? ("started" as const) : ("refused" as const);
  });
  return result ?? "busy";
}

export async function reconcileFluidQueuePhase(threadKey: string, running: boolean): Promise<void> {
  await writeState((state) => {
    const claim = state.claimsByThreadKey[threadKey];
    if (!claim) return null;
    const claims = { ...state.claimsByThreadKey };
    if (running && !claim.sawRunning) {
      claims[threadKey] = { ...claim, sawRunning: true };
    } else if (!running && (claim.sawRunning ||
      Date.now() - claim.startedAt >= FLUID_QUEUE_DISPATCH_START_TIMEOUT_MS)) {
      delete claims[threadKey];
    } else return null;
    return { enabled: state.enabled, entries: state.entries, claimsByThreadKey: claims };
  });
}

export function fluidQueueEntryLabel(entry: FluidQueueEntry): string {
  const prompt = entry.draft.prompt.replaceAll(/\s+/g, " ").trim();
  if (prompt) return prompt;
  const attachment = entry.draft.images[0] ?? entry.draft.files[0];
  if (attachment) return attachment.name;
  if (entry.draft.terminalContexts.length > 0) return "Terminal context";
  if (entry.draft.elementContexts.length > 0) return "Element context";
  if (entry.draft.previewAnnotations.length > 0) return "Preview annotation";
  if (entry.draft.reviewComments.length > 0) return "Review comment";
  return "Queued message";
}
