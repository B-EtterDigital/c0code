import type {
  AgentSessionProjectCandidate,
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CommandId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  groupOnboardingProjects,
  partitionOnboardingProjects,
  onboardingProjectKey,
  resolveOnboardingLandingProject,
  resolveOnboardingProjectId,
  type OnboardingProjectGroup,
} from "../../onboarding/projectImport.logic";
import { newProjectId, randomUUID } from "../../lib/utils";
import { agentSessionImport } from "../../state/agentSessions";
import { readProjects, useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { useProjectScans } from "../../onboarding/useProjectScans";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { ProjectFolderBrowser } from "./ProjectFolderBrowser";
import { StepShell } from "./OnboardingStepShell";
import { ImportCandidateList, type ImportCandidate } from "./OnboardingImportRows";
import { OnboardingProjectLogos, type OnboardingProjectLogo } from "./OnboardingProjectLogoPicker";

const SCAN_LIMIT_MESSAGE = "Folder scan limit reached. Choose a more specific folder to see the remaining projects.";
export function ImportStep({
  scans, roots, onRootsChange, scanDepth, onScanDepthChange, includeHistory, onIncludeHistoryChange,
  isImporting,
  setIsImporting,
  onDone,
}: {
  readonly scans: ReturnType<typeof useProjectScans>;
  readonly roots: Readonly<Record<string, readonly string[]>>;
  readonly onRootsChange: (roots: Readonly<Record<string, readonly string[]>>) => void;
  readonly scanDepth: 1 | 2 | 3;
  readonly onScanDepthChange: (depth: 1 | 2 | 3) => void;
  readonly includeHistory: boolean;
  readonly onIncludeHistoryChange: (value: boolean) => void;
  readonly isImporting: boolean;
  readonly setIsImporting: (value: boolean) => void;
  readonly onDone: (projectRef?: ScopedProjectRef) => Promise<boolean>;
}) {
  const { environments } = useEnvironments();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const [logos, setLogos] = useState<Readonly<Record<string, OnboardingProjectLogo>>>({});
  const importThreads = useAtomCommand(agentSessionImport, { reportFailure: false });
  const projects = useProjects();
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string> | null>(null);
  const [addedFolders, setAddedFolders] = useState<ReadonlyArray<ImportCandidate>>([]);
  const [importError, setImportError] = useState("");
  const [landingProject, setLandingProject] = useState<ScopedProjectRef | null>(null);
  // Keep project creation attempts separate from completed history imports so both can retry.
  const importedProjectsRef = useRef(new Map<string, ScopedProjectRef>());
  const projectsWithImportedHistoryRef = useRef(new Map<string, ScopedProjectRef>());
  const lastImportSelectionRef = useRef<ReadonlyArray<string>>([]);
  const projectAttemptsRef = useRef(
    new Map<string, { readonly projectId: ProjectId; readonly commandId: CommandId }>(),
  );
  const importGenerationRef = useRef(0);

  // Ignore command completions after leaving the import step.
  useEffect(() => {
    importGenerationRef.current += 1;
    return () => {
      importGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (
      landingProject !== null &&
      projects.some(
        (project) =>
          project.id === landingProject.projectId &&
          project.environmentId === landingProject.environmentId,
      )
    ) {
      setLandingProject(null);
      void onDone(landingProject).then((completed) => {
        if (!completed) setIsImporting(false);
      });
    }
  }, [landingProject, onDone, projects, setIsImporting]);

  const { available: candidates } = useMemo(
    () =>
      partitionOnboardingProjects(
        [...scans.flatMap((scan) =>
          (scan.data?.candidates ?? []).map((candidate) => ({
            ...candidate,
            environmentId: scan.environmentId,
            key: onboardingProjectKey(scan.environmentId, candidate.path),
          })),
        ), ...addedFolders.filter((folder) => !scans.some((scan) =>
          scan.environmentId === folder.environmentId && scan.data?.candidates.some((candidate) => candidate.path === folder.path),
        ))],
      ),
    [scans, addedFolders],
  );
  const selectedKeys = useMemo(
    () => selectedPaths ?? new Set<string>(),
    [selectedPaths],
  );
  const selected = candidates.filter((candidate) => selectedKeys.has(candidate.key));

  const finishAfterImport = () => {
    const projectRef = resolveOnboardingLandingProject(
      lastImportSelectionRef.current,
      projectsWithImportedHistoryRef.current,
      importedProjectsRef.current,
    );
    if (projectRef === undefined) {
      void onDone();
      return;
    }
    setIsImporting(true);
    setLandingProject(projectRef);
  };

  const runImport = async (selection: typeof candidates) => {
    if (isImporting) return;
    if (selection.length === 0) {
      void onDone();
      return;
    }
    setIsImporting(true);
    setImportError("");
    lastImportSelectionRef.current = selection.map((candidate) => candidate.key);
    const importGeneration = importGenerationRef.current;
    const importedProjects = importedProjectsRef.current;
    const projectAttempts = projectAttemptsRef.current;
    // Interrupted imports are neither failures nor successes — the command was
    // superseded or the environment dropped — but they still didn't land, so
    // they must not read as "imported everything". Retries skip paths that
    // already landed this session (re-creating them would only trip the
    // duplicate-root invariant and read as a failure).
    let importedProjectsCount =
      importedProjects.size > 0
        ? selection.filter((candidate) => importedProjects.has(candidate.key)).length
        : 0;
    let importedThreadCount = 0;
    let skippedThreadCount = 0;
    const refreshEnvironments = new Set<EnvironmentId>();
    for (const candidate of selection) {
      const { environmentId } = candidate;
      if (
        importGeneration !== importGenerationRef.current ||
        importedProjects !== importedProjectsRef.current
      ) {
        return;
      }
      if (importedProjects.has(candidate.key)) continue;
      let projectId = resolveOnboardingProjectId(readProjects(), environmentId, candidate);
      if (projectId === null) {
        let attempt = projectAttempts.get(candidate.key);
        if (attempt === undefined) {
          const nextProjectId = newProjectId();
          attempt = {
            projectId: nextProjectId,
            commandId: CommandId.make(`onboarding:project:create:${nextProjectId}`),
          };
          projectAttempts.set(candidate.key, attempt);
        }
        projectId = attempt.projectId;
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            commandId: attempt.commandId,
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (
          importGeneration !== importGenerationRef.current ||
          importedProjects !== importedProjectsRef.current
        ) {
          return;
        }
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            projectAttempts.delete(candidate.key);
            refreshEnvironments.add(environmentId);
          }
          continue;
        }
      }

      const logo = logos[candidate.key];
      if (logo) {
        const result = await updateProject({ environmentId, input: { projectId, ...logo } });
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            console.error("[c0x-t3-error] onboarding.saveProjectLogo", String(squashAtomCommandFailure(result)));
            setImportError(`Could not save the logo for ${candidate.title}. Retry to finish this project.`);
          }
          continue;
        }
      }
      if (!includeHistory) {
        importedProjectsCount += 1;
        importedProjects.set(candidate.key, scopeProjectRef(environmentId, projectId));
        continue;
      }
      const threadImportResult = await importThreads({
        environmentId,
        input: { projectId, expectedWorkspaceRoot: candidate.path },
      });
      if (
        importGeneration !== importGenerationRef.current ||
        importedProjects !== importedProjectsRef.current
      ) {
        return;
      }
      if (threadImportResult._tag === "Success") {
        importedThreadCount += threadImportResult.value.importedCount;
        skippedThreadCount += threadImportResult.value.skippedCount;
        if (threadImportResult.value.importedCount > 0) {
          projectsWithImportedHistoryRef.current.set(
            candidate.key,
            scopeProjectRef(environmentId, projectId),
          );
        }
        if (threadImportResult.value.skippedCount === 0) {
          importedProjectsCount += 1;
          importedProjects.set(candidate.key, scopeProjectRef(environmentId, projectId));
        }
      } else if (!isAtomCommandInterrupted(threadImportResult)) {
        projectAttempts.delete(candidate.key);
        refreshEnvironments.add(environmentId);
      }
    }
    for (const scan of scans) {
      if (refreshEnvironments.has(scan.environmentId)) scan.refresh();
    }
    setIsImporting(false);
    if (importedProjectsCount < selection.length) {
      if (importedThreadCount > 0 && skippedThreadCount > 0) {
        setImportError(
          `Imported ${importedThreadCount} ${importedThreadCount === 1 ? "thread" : "threads"}. ${skippedThreadCount} ${skippedThreadCount === 1 ? "thread" : "threads"} could not be imported.`,
        );
      } else if (skippedThreadCount > 0) {
        setImportError(
          `${skippedThreadCount} ${skippedThreadCount === 1 ? "thread could" : "threads could"} not be imported.`,
        );
      } else if (importedThreadCount > 0) {
        setImportError(
          `Imported ${importedThreadCount} ${importedThreadCount === 1 ? "thread" : "threads"}. Some thread history could not be imported.`,
        );
      } else {
        setImportError("Could not import thread history.");
      }
      return;
    }
    finishAfterImport();
  };

  return (
    <StepShell
      title="Choose your projects"
      description="Choose your development folder first. We’ll suggest projects inside it; nothing is selected until you choose."
    >
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">Look inside
          <select aria-label="Project search depth" className="rounded-md border border-border bg-background px-2 py-1" value={scanDepth} disabled={isImporting} onChange={(event) => onScanDepthChange(Number(event.target.value) as 1 | 2 | 3)}>
            <option value={1}>Direct subfolders</option><option value={2}>Two folder levels</option><option value={3}>Three folder levels</option>
          </select>
        </label>
        <label className="flex items-center gap-2"><Checkbox checked={includeHistory} disabled={isImporting} onCheckedChange={(checked) => onIncludeHistoryChange(checked === true)} />Include existing conversations</label>
      </div>
      {candidates.length > 0 ? (
        <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span role="status">
            {selected.length} of {candidates.length} selected
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={isImporting || selected.length === candidates.length}
              onClick={() => setSelectedPaths(new Set(candidates.map((item) => item.key)))}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={isImporting || selected.length === 0}
              onClick={() => setSelectedPaths(new Set())}
            >
              Select none
            </Button>
          </div>
        </div>
      ) : null}
      <ScrollArea
        scrollFade
        className="mt-2 h-auto max-h-80 [&_[data-slot=scroll-area-scrollbar]]:opacity-100"
      >
        <div className="space-y-5 pr-3">
          {scans.map((scan) => {
            const scanCandidates = candidates.filter(
              (candidate) => candidate.environmentId === scan.environmentId,
            );
            const label =
              environments.find((environment) => environment.environmentId === scan.environmentId)
                ?.label ?? "Computer";
            return (
              <fieldset
                key={scan.environmentId}
                className="min-w-0 space-y-0.5"
                disabled={isImporting}
              >
                {scans.length > 1 ? (
                  <legend className="mb-2 text-sm font-medium">{label}</legend>
                ) : null}
                <ProjectFolderBrowser environmentId={scan.environmentId} disabled={isImporting || (roots[scan.environmentId]?.length ?? 0) >= 8} label="Choose development folder" confirmLabel="Find projects in this folder" onSelect={(path) => {
                  const current = roots[scan.environmentId] ?? [];
                  if (!current.includes(path)) onRootsChange({ ...roots, [scan.environmentId]: [...current, path] });
                }} />
                {(roots[scan.environmentId] ?? []).map((root) => <div key={root} className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="truncate" title={root}>{root}</span><Button size="xs" variant="ghost" disabled={isImporting} onClick={() => onRootsChange({ ...roots, [scan.environmentId]: roots[scan.environmentId]!.filter((value) => value !== root) })}>Remove</Button></div>)}
                <ProjectFolderBrowser environmentId={scan.environmentId} disabled={isImporting} onSelect={(path) => {
                  const key = onboardingProjectKey(scan.environmentId, path);
                  setAddedFolders((current) => current.some((folder) => folder.key === key) ? current : [...current, {
                    key, environmentId: scan.environmentId, path,
                    title: path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path,
                    sources: [], threadCount: 0, lastActiveAt: null, alreadyImported: false,
                  }]);
                  setSelectedPaths(new Set([...selectedKeys, key]));
                }} />
                {scan.isPending && scan.data === null ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Looking for projects…
                  </div>
                ) : scan.error !== null ? (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
                  >
                    <span>Could not check projects. {scan.error}</span>
                    <Button variant="ghost" size="sm" onClick={scan.refresh}>
                      Retry
                    </Button>
                  </div>
                ) : scanCandidates.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    Choose a development folder to find projects, or browse to add one project directly.
                  </p>
                ) : null}
                {scan.data?.truncated ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {SCAN_LIMIT_MESSAGE}
                  </p>
                ) : null}
                <OnboardingProjectLogos.Provider value={{ logos, setLogo: (key, logo) => setLogos((current) => ({ ...current, [key]: logo })) }}>
                <ImportCandidateList
                  candidates={scanCandidates}
                  selectedKeys={selectedKeys}
                  onSelectionChange={setSelectedPaths}
                />
                </OnboardingProjectLogos.Provider>
              </fieldset>
            );
          })}
        </div>
      </ScrollArea>
      {importError ? <p className="mt-3 text-sm text-destructive">{importError}</p> : null}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="ghost-muted"
          disabled={isImporting}
          onClick={importError ? finishAfterImport : () => void onDone()}
        >
          {importError ? "Continue without the rest" : "Do not import projects"}
        </Button>
        <Button
          autoFocus
          disabled={isImporting}
          onClick={() => void runImport(selected)}
        >
          {isImporting
            ? "Importing…"
            : selected.length === 0 ? "Continue without importing"
            : `Import ${selected.length} ${selected.length === 1 ? "project" : "projects"}`}
        </Button>
      </div>
    </StepShell>
  );
}
