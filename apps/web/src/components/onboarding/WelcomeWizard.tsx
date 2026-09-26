import type {
  AgentSessionProjectCandidate,
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useCompleteOnboarding } from "../../onboarding/firstRun";
import { subscribeSharedOnboardingCompletion } from "../../onboarding/clientSettingsCompletion";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { useProjectScans } from "../../onboarding/useProjectScans";
import { C0CodeWordmark } from "./C0CodeWordmark";
import { WizardPanel, WizardSteps } from "../ui/wizard";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { ConnectionStep } from "./OnboardingConnectionStep";
import { AgentsStep } from "./OnboardingAgentsStep";
import { ImportStep } from "./OnboardingImportStep";

type WizardStep = "connection" | "agents" | "import";
const NO_ENVIRONMENTS: readonly EnvironmentId[] = [];

const ONBOARDING_STAGES = ["Connect", "Agents", "Projects"] as const;

export function WelcomeWizard({
  localAvailable,
  onDone,
}: {
  /** Whether this client is authenticated to the server serving the app. */
  readonly localAvailable: boolean;
  readonly onDone: (projectRef?: ScopedProjectRef) => void;
}) {
  const completeOnboarding = useCompleteOnboarding();
  const [step, setStep] = useState<WizardStep>("connection");
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<ReadonlySet<EnvironmentId> | null>(null);
  const autoSelectedComputers = useRef(new Set<EnvironmentId>());
  const [setupIds, setSetupIds] = useState<readonly EnvironmentId[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const finishingPromiseRef = useRef<Promise<boolean> | null>(null);
  const completionErrorToastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const primaryEnvironment = usePrimaryEnvironment();
  useEffect(
    () =>
      subscribeSharedOnboardingCompletion(() => {
        if (!isImporting && finishingPromiseRef.current === null) onDone();
      }),
    [isImporting, onDone],
  );
  useEffect(() => {
    const newComputers = environments.filter(
      (environment) => !autoSelectedComputers.current.has(environment.environmentId),
    );
    if (newComputers.length === 0) return;
    for (const environment of newComputers) {
      autoSelectedComputers.current.add(environment.environmentId);
    }
    setSelection(
      (current) =>
        new Set([
          ...(current ?? []),
          ...newComputers.map((environment) => environment.environmentId),
        ]),
    );
  }, [environments]);
  const selectedIds =
    selection ?? new Set(primaryEnvironment ? [primaryEnvironment.environmentId] : []);
  const [roots, setRoots] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [scanDepth, setScanDepth] = useState<1 | 2 | 3>(2);
  const [includeHistory, setIncludeHistory] = useState(false);
  const scans = useProjectScans(
    step === "import" ? setupIds : NO_ENVIRONMENTS,
    roots,
    scanDepth,
    includeHistory,
  );
  const isLoadingProjects =
    step === "import" &&
    scans.every((scan) => scan.data === null) &&
    scans.some((scan) => scan.isPending);
  const startSetup = (ids: readonly EnvironmentId[]) => {
    if (ids.length === 0) return;
    setSetupIds(ids);
    setStep("agents");
  };
  const stageIndex = step === "agents" ? 1 : step === "import" ? 2 : 0;
  const finish = useCallback(
    (projectRef?: ScopedProjectRef) => {
      if (finishingPromiseRef.current !== null) return finishingPromiseRef.current;
      if (completionErrorToastIdRef.current !== null) {
        toastManager.close(completionErrorToastIdRef.current);
        completionErrorToastIdRef.current = null;
      }

      const completion = completeOnboarding()
        .then(() => {
          if (completionErrorToastIdRef.current !== null) {
            toastManager.close(completionErrorToastIdRef.current);
            completionErrorToastIdRef.current = null;
          }
          onDone(projectRef);
          return true;
        })
        .catch((error: unknown) => {
          console.error("[c0x-t3-error] onboarding.complete", String(error));
          const errorToast = {
            type: "error",
            title: "Could not finish setup",
            description: "Your settings could not be saved. Try again.",
          } as const;
          if (completionErrorToastIdRef.current === null) {
            completionErrorToastIdRef.current = toastManager.add(errorToast);
          } else {
            toastManager.update(completionErrorToastIdRef.current, errorToast);
          }
          return false;
        })
        .finally(() => {
          if (finishingPromiseRef.current === completion) {
            finishingPromiseRef.current = null;
          }
        });
      finishingPromiseRef.current = completion;
      return completion;
    },
    [completeOnboarding, onDone],
  );

  return (
    <Dialog open disablePointerDismissal onOpenChange={(_, event) => event.cancel()}>
      <DialogPopup
        className="max-w-xl overflow-x-hidden overflow-y-auto"
        bottomStickOnMobile={false}
        showCloseButton={false}
        initialFocus={() => document.getElementById("onboarding-pairing-url") ?? true}
      >
        <DialogTitle className="sr-only">Set up C0CODE</DialogTitle>
        <div className="flex min-h-0 flex-col">
          <DialogHeader className="gap-4">
            <C0CodeWordmark />
            <WizardSteps
              steps={ONBOARDING_STAGES}
              currentStep={stageIndex}
              isStepDisabled={(index) => isImporting || index >= stageIndex}
              onStepChange={(index) => {
                if (isImporting || index > stageIndex) return;
                setStep(index === 0 ? "connection" : "agents");
              }}
            />
          </DialogHeader>

          <WizardPanel className="min-w-0" holdHeight={isLoadingProjects}>
            {step === "connection" ? (
              <ConnectionStep
                expandPairingInitially={!localAvailable && !hasCloudPublicConfig()}
                selectedIds={selectedIds}
                autoSelectedComputers={autoSelectedComputers.current}
                onSelectionChange={setSelection}
                onToggleEnvironment={(environmentId, checked) =>
                  setSelection((current) => {
                    const next = new Set(current ?? selectedIds);
                    if (checked) next.add(environmentId);
                    else next.delete(environmentId);
                    return next;
                  })
                }
                onContinue={() =>
                  startSetup(
                    environments
                      .filter((environment) => selectedIds.has(environment.environmentId))
                      .map((environment) => environment.environmentId),
                  )
                }
                onPaired={(environmentId) => {
                  setSelection(new Set([...selectedIds, environmentId]));
                }}
              />
            ) : step === "agents" ? (
              <AgentsStep environmentIds={setupIds} onContinue={() => setStep("import")} />
            ) : (
              <ImportStep
                scans={scans}
                roots={roots}
                onRootsChange={setRoots}
                scanDepth={scanDepth}
                onScanDepthChange={setScanDepth}
                includeHistory={includeHistory}
                onIncludeHistoryChange={setIncludeHistory}
                isImporting={isImporting}
                setIsImporting={setIsImporting}
                onDone={finish}
              />
            )}
          </WizardPanel>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

// ── Step 1: connection choice ────────────────────────────────
