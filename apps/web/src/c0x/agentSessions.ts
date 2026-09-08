import { useEffect } from "react";
import { ProjectId, type EnvironmentId } from "@t3tools/contracts";
import { agentSessionImport } from "../state/agentSessions";
import { useAtomCommand } from "../state/use-atom-command";

interface NativeSessionImport {
  projectId: string;
  workspaceRoot: string;
}

declare global {
  interface Window {
    __c0xImportAgentSession?: (input: NativeSessionImport) => Promise<{ importedCount: number }>;
  }
}

/** Use the connected environment's authenticated importer; never start a provider turn. */
export function useC0xAgentSessionImport(environmentId: EnvironmentId): void {
  const importSession = useAtomCommand(agentSessionImport);
  useEffect(() => {
    const invoke = async (input: NativeSessionImport) => {
      const result = await importSession({
        environmentId,
        input: {
          projectId: ProjectId.make(input.projectId),
          expectedWorkspaceRoot: input.workspaceRoot,
        },
      });
      if (result._tag !== "Success") throw new Error("The native session importer did not complete.");
      if (result.value.importedCount === 0) throw new Error("The selected session could not be imported by this environment.");
      return { importedCount: result.value.importedCount };
    };
    window.__c0xImportAgentSession = invoke;
    return () => {
      if (window.__c0xImportAgentSession === invoke) delete window.__c0xImportAgentSession;
    };
  }, [environmentId, importSession]);
}
