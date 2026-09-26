import { useState } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { OnboardingProjectLogoPicker, OnboardingProjectLogos, type OnboardingProjectLogo } from "../onboarding/OnboardingProjectLogoPicker";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";

/** Edits the canonical project record: sidebar and every split share its logo. */
export function C0xProjectLogoEditor({ target, onClose }: {
  target: { projectId: string; environmentId?: string }; onClose: () => void;
}) {
  const projects = useProjects();
  const project = projects.find((entry) => entry.id === target.projectId && (!target.environmentId || entry.environmentId === target.environmentId));
  const update = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const [choice, setChoice] = useState<OnboardingProjectLogo | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!project || !choice || saving) return;
    setSaving(true); setError("");
    try {
      const result = await update({ environmentId: project.environmentId, input: {
        projectId: project.id, ...choice,
      } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      onClose();
    } catch (cause) {
      console.error("[c0x-t3-error] projectLogo.save", cause);
      setError(cause instanceof Error ? cause.message : "Could not save the project logo.");
    } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogPopup className="max-w-xl"><DialogTitle>Project logo</DialogTitle>
      {project ? <OnboardingProjectLogos.Provider value={{ logos: { [project.id]: choice ?? {
        faviconPath: project.faviconPath ?? null, projectIcon: project.projectIcon ?? null,
      } }, setLogo: (_key, logo) => setChoice(logo) }}>
        <p className="mb-4 text-sm text-muted-foreground">{project.title}</p>
        <OnboardingProjectLogoPicker candidate={{ key: project.id, environmentId: project.environmentId, title: project.title, path: project.workspaceRoot }} />
      </OnboardingProjectLogos.Provider> : <p role="alert">The project is unavailable.</p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button disabled={!project || !choice || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button></div>
    </DialogPopup>
  </Dialog>;
}
