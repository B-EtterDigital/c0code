import type { EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CopyIcon, FolderIcon } from "lucide-react";
import { useState } from "react";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useRevealInFileManager } from "../../hooks/useRevealInFileManager";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

export function HostFolderView({
  environmentId,
  path,
}: {
  environmentId: EnvironmentId;
  path: string;
}) {
  const { revealInFileManagerLabel, revealFileInFileManager } =
    useRevealInFileManager(environmentId);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const report = (operation: string, error: unknown) => {
    console.error("[c0x-t3-error] folder.action", { operation, path, error });
    toastManager.add({
      type: "error",
      title: operation,
      description: error instanceof Error ? error.message : String(error),
    });
  };
  const reveal = async () => {
    if (pending) return;
    setPending(true);
    try {
      const result = await revealFileInFileManager(path, "folder");
      if (result._tag !== "Success" && !isAtomCommandInterrupted(result)) {
        report("Unable to reveal folder", squashAtomCommandFailure(result));
      }
    } catch (error) {
      report("Unable to reveal folder", error);
    } finally {
      setPending(false);
    }
  };
  const copy = async () => {
    try {
      setCopied(await writeTextToClipboard(path, "folder path"));
    } catch (error) {
      report("Unable to copy path", error);
    }
  };
  return (
    <section
      aria-label="Folder"
      className="flex min-h-0 flex-1 flex-col items-start gap-3 overflow-auto p-4 text-sm text-foreground"
    >
      <div className="flex items-center gap-2">
        <FolderIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        Folder
      </div>
      <p
        className="max-w-full break-all font-mono text-xs text-muted-foreground"
        data-folder-path={path}
      >
        {path}
      </p>
      <div className="flex flex-wrap gap-2">
        {revealInFileManagerLabel ? (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => void reveal()}>
            {revealInFileManagerLabel}
          </Button>
        ) : null}
        <Button size="xs" variant="outline" onClick={() => void copy()}>
          <CopyIcon className="size-3.5" />
          {copied ? "Copied" : "Copy path"}
        </Button>
      </div>
    </section>
  );
}
