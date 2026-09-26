import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CommandId, type EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { environmentCatalog } from "../../connection/catalog";
import { useComposerDraftStore } from "../../composerDraftStore";
import { newDraftId, newProjectId, randomUUID } from "../../lib/utils";
import { readProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { primaryServerProvidersAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectionStep } from "../onboarding/OnboardingConnectionStep";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { getDriverOption } from "../settings/providerDriverMeta";
import { C0xProjectLogoEditor } from "./C0xProjectLogoEditor";

type HandoffInput = {
  cwd: string;
  title: string;
  prompt: string;
  instanceId: string;
  model: string;
};
interface C0xHostControlsApi {
  computers(): {
    id: string;
    label: string;
    address: string | null;
    phase: string;
    local: boolean;
  }[];
  providers(): {
    instanceId: string;
    driver: string;
    label: string;
    ready: boolean;
    models: { id: string; name: string; group: string | null }[];
  }[];
  addComputer(): boolean;
  removeComputer(id: string): Promise<boolean>;
  handoff(input: HandoffInput): Promise<{ route: string }>;
  newDraft(input: { projectId: string }): Promise<{ route: string; anchor: string }>;
  customizeProjectLogo(input: { projectId: string; environmentId?: string }): boolean;
}
declare global {
  interface Window {
    __c0xHostControls?: C0xHostControlsApi;
  }
}

/** Host chrome uses the same connected computers and provider instances as setup. */
export function C0xHostControls() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironment();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const remove = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const create = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const [adding, setAdding] = useState(false);
  const [logoProject, setLogoProject] = useState<{
    projectId: string;
    environmentId?: string;
  } | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<EnvironmentId>>(new Set());
  useEffect(() => {
    if (!window.c0codeConnectionBridge) return;
    const api: C0xHostControlsApi = {
      computers: () =>
        environments.map((environment) => ({
          id: environment.environmentId,
          label: environment.label,
          address: environment.displayUrl,
          phase: environment.connection.phase,
          local: environment.environmentId === primary?.environmentId,
        })),
      providers: () =>
        providers
          .filter((provider) => provider.enabled)
          .map((provider) => ({
            instanceId: provider.instanceId,
            driver: provider.driver,
            label:
              provider.displayName || getDriverOption(provider.driver)?.label || provider.driver,
            ready:
              provider.installed &&
              provider.availability !== "unavailable" &&
              provider.auth.status === "authenticated",
            models: provider.models.map((model) => ({
              id: model.slug,
              name: model.name,
              group: model.subProvider ?? null,
            })),
          })),
      addComputer: () => {
        setSelection(new Set(environments.map((environment) => environment.environmentId)));
        setAdding(true);
        return true;
      },
      customizeProjectLogo: (input) => {
        setLogoProject(input);
        return true;
      },
      newDraft: async ({ projectId }) => {
        const project = readProjects().find((entry) => entry.id === projectId);
        if (!project) throw new Error("The selected project is unavailable.");
        const environment = environments.find(
          (entry) => entry.environmentId === project.environmentId,
        );
        if (environment?.connection.phase !== "connected")
          throw new Error("Connect this project's computer first.");
        const draftId = newDraftId();
        const store = useComposerDraftStore.getState();
        // Separate draft identity also preserves older blank composers with
        // shell-owned split layouts. Only the first send creates a thread.
        store.setLogicalProjectDraftThreadId(
          `c0code:${draftId}`,
          scopeProjectRef(project.environmentId, project.id),
          draftId,
          { environmentSelection: "manual", envMode: "local" },
        );
        if (project.defaultModelSelection)
          store.setModelSelection(draftId, project.defaultModelSelection, { explicit: false });
        return { route: `/draft/${draftId}`, anchor: draftId };
      },
      removeComputer: async (id) => {
        const environment = environments.find((entry) => entry.environmentId === id);
        if (!environment || environment.environmentId === primary?.environmentId)
          throw new Error("This computer cannot be removed.");
        const result = await remove(environment.environmentId);
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        return true;
      },
      handoff: async (input) => {
        if (!primary || primary.connection.phase !== "connected")
          throw new Error("The local computer is not connected.");
        const provider = providers.find(
          (entry) => entry.instanceId === input.instanceId && entry.enabled && entry.installed,
        );
        if (!provider || !provider.models.some((model) => model.slug === input.model))
          throw new Error("Choose an available CLI and model.");
        if (!input.prompt.trim() || input.prompt.length > 200_000 || !input.cwd.trim())
          throw new Error("The session handoff is invalid.");
        const environmentId = primary.environmentId;
        let projectId = readProjects().find(
          (project) =>
            project.environmentId === environmentId && project.workspaceRoot === input.cwd,
        )?.id;
        if (!projectId) {
          projectId = newProjectId();
          const result = await create({
            environmentId,
            input: {
              projectId,
              commandId: CommandId.make(`c0code:handoff:${randomUUID()}`),
              title: input.title,
              workspaceRoot: input.cwd,
              createWorkspaceRootIfMissing: false,
              defaultModelSelection: null,
            },
          });
          if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        }
        const draftId = newDraftId();
        const store = useComposerDraftStore.getState();
        store.setProjectDraftThreadId(scopeProjectRef(environmentId, projectId), draftId, {
          environmentSelection: "manual",
          envMode: "local",
        });
        store.setModelSelection(
          draftId,
          { instanceId: provider.instanceId, model: input.model },
          { explicit: true },
        );
        store.setPrompt(draftId, input.prompt);
        return { route: `/draft/${draftId}` };
      },
    };
    window.__c0xHostControls = api;
    return () => {
      if (window.__c0xHostControls === api) delete window.__c0xHostControls;
    };
  }, [environments, primary, providers, remove, create]);
  return (
    <>
      {logoProject ? (
        <C0xProjectLogoEditor target={logoProject} onClose={() => setLogoProject(null)} />
      ) : null}
      {adding ? (
        <Dialog open onOpenChange={setAdding}>
          <DialogPopup className="max-w-xl overflow-y-auto">
            <DialogTitle className="sr-only">Your computers</DialogTitle>
            <ConnectionStep
              expandPairingInitially
              autoSelectedComputers={new Set()}
              selectedIds={selection}
              onSelectionChange={setSelection}
              onToggleEnvironment={(id, checked) =>
                setSelection((current) => {
                  const next = new Set(current);
                  if (checked) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onPaired={(id) => setSelection((current) => new Set([...current, id]))}
              onContinue={() => setAdding(false)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
