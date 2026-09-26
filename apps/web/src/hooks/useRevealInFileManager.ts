import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";
import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "../components/preview/fileExplorerLabel";
import {
  PreferredEditorEnvironmentRequiredError,
  PreferredEditorUnavailableError,
} from "../editorPreferences";
import { serverEnvironment } from "../state/server";
import { shellEnvironment } from "../state/shell";
import { useAtomCommand } from "../state/use-atom-command";

export function fileManagerRevealLabel(
  config: ServerConfig | null | undefined,
): string | undefined {
  if (!config?.shellRevealInFileManager || !config.availableEditors.includes("file-manager"))
    return undefined;
  return config.shellRevealInFileManagerKind === undefined
    ? revealInFileExplorerLabelForOs(config.environment.platform.os)
    : revealInFileExplorerLabelForKind(config.shellRevealInFileManagerKind);
}

/** Reveal on the selected computer, only when that server advertises the action. */
export function useRevealInFileManager(environmentId: EnvironmentId | null) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const label = environmentId === null ? undefined : fileManagerRevealLabel(config);
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const revealFileInFileManager = useCallback(
    (targetPath: string) => {
      if (environmentId === null) {
        return Promise.resolve(
          AsyncResult.failure<void, PreferredEditorEnvironmentRequiredError>(
            Cause.fail(new PreferredEditorEnvironmentRequiredError({ targetPath })),
          ),
        );
      }
      if (label === undefined) {
        return Promise.resolve(
          AsyncResult.failure<void, PreferredEditorUnavailableError>(
            Cause.fail(
              new PreferredEditorUnavailableError({
                environmentId,
                targetPath,
                availableEditorIds: config?.availableEditors ?? [],
              }),
            ),
          ),
        );
      }
      return openInEditor({
        environmentId,
        input: { cwd: targetPath, editor: "file-manager", reveal: true },
      });
    },
    [config?.availableEditors, environmentId, label, openInEditor],
  );
  return { revealInFileManagerLabel: label, revealFileInFileManager };
}
