import { composerTargetKey, type ComposerThreadTarget } from '~/composerDraftStore';
import { postC0xShellEvent } from './nativeShell';

type Entry = { targetKey: string; text?: string; imageId?: string };
const media = new Map<string, Entry>();

export function recordC0xComposerMedia(id: string | undefined, entry: Entry): void {
  if (!id) return;
  media.set(id, entry);
  if (media.size > 512) {
    const oldest = media.keys().next().value;
    if (oldest !== undefined) media.delete(oldest);
  }
}

/** Freeze only media represented in this send, before any asynchronous upload. */
export function snapshotC0xComposerMediaSubmission(
  target: ComposerThreadTarget, prompt: string, images: ReadonlyArray<{ id: string }>,
): { targetKey: string; mediaIds: string[] } {
  const targetKey = composerTargetKey(target);
  const imageIds = new Set(images.map((image) => image.id));
  return { targetKey, mediaIds: [...media].filter(([, entry]) => entry.targetKey === targetKey
    && ((entry.text !== undefined && prompt.includes(entry.text))
      || (entry.imageId !== undefined && imageIds.has(entry.imageId)))).map(([id]) => id) };
}

export function acknowledgeC0xComposerMediaSubmission(receipt: ReturnType<typeof snapshotC0xComposerMediaSubmission>): void {
  if (receipt.mediaIds.length === 0) return;
  postC0xShellEvent({ type: 'composer-media', action: 'submitted', requestId: crypto.randomUUID(), ...receipt });
  for (const id of receipt.mediaIds) media.delete(id);
}
