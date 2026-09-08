import type { ComposerThreadDraftState } from "../composerDraftStore";

/** Persisted snapshots omit live File objects and terminal text; retain those by identity. */
export function preserveLiveComposerDraft(
  hydrated: ComposerThreadDraftState,
  current: ComposerThreadDraftState | undefined,
): ComposerThreadDraftState {
  if (!current) return hydrated;
  const persistedIds = new Set(current.persistedAttachments.map((attachment) => attachment.id));
  const pending = new Set(current.images.filter((image) => !persistedIds.has(image.id)).map((image) => image.id));
  const images = hydrated.images.map((image) => {
    const existing = current.images.find((candidate) => candidate.id === image.id);
    return existing ?? image;
  });
  for (const image of current.images) {
    if (pending.has(image.id) && !images.some((candidate) => candidate.id === image.id)) {
      images.push(image);
    }
  }
  return {
    ...hydrated,
    images,
    nonPersistedImageIds: current.nonPersistedImageIds.filter((id) =>
      !hydrated.persistedAttachments.some((attachment) => attachment.id === id)),
    files: hydrated.files.map((file) => ({
      ...file,
      file: current.files.find((candidate) => candidate.id === file.id)?.file ?? file.file,
    })),
    terminalContexts: hydrated.terminalContexts.map((context) => ({
      ...context,
      text: current.terminalContexts.find((candidate) => candidate.id === context.id)?.text ?? context.text,
    })),
  };
}
