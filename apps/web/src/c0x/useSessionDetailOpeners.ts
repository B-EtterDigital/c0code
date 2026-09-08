import { useCallback } from 'react';
import type { ChatFileAttachment, EnvironmentId, ScopedThreadRef } from '@t3tools/contracts';
import { useOpenLink } from '../browser/useOpenLink';
import type { ChatAttachment } from '../types';
import type { ExpandedImagePreview } from '../components/chat/ExpandedImagePreview';
import { postC0xShellEvent } from './nativeShell';
import { sessionFileRelativePath } from './sessionDetailsSurface';

export function useSessionDetailOpeners(input: {
  threadRef: ScopedThreadRef | null | undefined;
  environmentId: EnvironmentId;
  workspaceRoot: string | null | undefined;
  openFile: (relativePath: string) => void;
  openFileAttachment: (attachment: ChatFileAttachment) => void;
  openImage: (preview: ExpandedImagePreview) => void;
}) {
  const openLink = useOpenLink(input.threadRef);
  const onOpenUrl = useCallback((url: string) => {
    void openLink(url).catch(error => postC0xShellEvent({
      type: 'session-details-error', operation: 'open-url',
      message: error instanceof Error ? error.message : String(error),
    }));
  }, [openLink]);
  const { environmentId, workspaceRoot, openFile, openFileAttachment, openImage } = input;
  const onOpenFile = useCallback((path: string) => {
    const relative = sessionFileRelativePath(path, workspaceRoot);
    if (relative) openFile(relative);
    else postC0xShellEvent({ type: 'session-details-error', operation: 'open-file',
      message: 'The recorded file is outside this conversation workspace.' });
  }, [workspaceRoot, openFile]);
  const onOpenAttachment = useCallback((attachment: ChatAttachment) => {
    if (attachment.type === 'file') {
      openFileAttachment(attachment);
      return;
    }
    openImage({ index: 0, images: [{
      src: attachment.previewUrl ?? null, name: attachment.name,
      actionsSource: { kind: 'image', name: attachment.name, asset: {
        environmentId, resource: { _tag: 'attachment', attachmentId: attachment.id,
          fileName: attachment.name, mimeType: attachment.mimeType },
      } },
    }] });
  }, [environmentId, openFileAttachment, openImage]);
  return { onOpenUrl, onOpenFile, onOpenAttachment };
}
