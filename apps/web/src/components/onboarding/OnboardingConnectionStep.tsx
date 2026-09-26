import { useAuth } from "@clerk/react";
import type {
  AgentSessionProjectCandidate,
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  CopyIcon,
  LinkIcon,
  MonitorIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { isOnboardingRelayEnvironment } from "../../onboarding/targetEnvironment.logic";
import { useAtomCommand } from "../../state/use-atom-command";
import { connectPairing } from "../../connection/onboarding";
import { CloudEnvironmentConnectRows } from "../cloud/CloudEnvironmentConnectList";
import { GuidedComputerConnection } from "./GuidedComputerConnection";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { StepShell, CommandBlock } from "./OnboardingStepShell";

export function ConnectionStep({
  autoSelectedComputers,
  expandPairingInitially,
  selectedIds,
  onSelectionChange,
  onToggleEnvironment,
  onContinue,
  onPaired,
}: {
  readonly autoSelectedComputers: Set<EnvironmentId>;
  readonly expandPairingInitially: boolean;
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId>) => void;
  readonly onToggleEnvironment: (environmentId: EnvironmentId, checked: boolean) => void;
  readonly onContinue: () => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const { environments } = useEnvironments();
  const cloudEnabled = hasCloudPublicConfig();
  const directEnvironments = environments.filter(
    (environment) => !cloudEnabled || !isOnboardingRelayEnvironment(environment),
  );
  const [pairingOpen, setPairingOpen] = useState(expandPairingInitially);
  const [isPairing, setIsPairing] = useState(false);
  const ready =
    selectedIds.size > 0 &&
    [...selectedIds].every((id) =>
      environments.some(
        (environment) =>
          environment.environmentId === id && environment.connection.phase === "connected",
      ),
    );
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      ready &&
      (document.activeElement === document.body ||
        document.activeElement?.getAttribute("role") === "dialog")
    ) {
      continueRef.current?.focus();
    }
  }, [ready]);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Connect your local and remote computers
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
        Choose one or more computers. We’ll set up agents and projects on each.
      </p>
      {directEnvironments.length > 0 ? (
        <fieldset className="mt-5 space-y-2">
          <legend className="sr-only">Computers to set up</legend>
          {directEnvironments.map((environment) => (
            <label
              key={environment.environmentId}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-3"
            >
              <Checkbox
                checked={selectedIds.has(environment.environmentId)}
                onCheckedChange={(checked) => {
                  const next = new Set(selectedIds);
                  if (checked) next.add(environment.environmentId);
                  else next.delete(environment.environmentId);
                  onSelectionChange(next);
                }}
              />
              <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium break-words">
                    {environment.label}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {environment.connection.phase === "connected" ? "Connected" : "Connecting…"}
                  </span>
                </span>
                {environment.displayUrl ? (
                  <span className="mt-0.5 block text-xs break-all text-muted-foreground">
                    {environment.displayUrl}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="mt-4 space-y-2">
        {cloudEnabled ? (
          <ConnectAccountOption
            autoSelectedComputers={autoSelectedComputers}
            disabled={isPairing}
            selectedIds={selectedIds}
            onToggleEnvironment={onToggleEnvironment}
          />
        ) : null}
        <Collapsible
          open={pairingOpen}
          onOpenChange={setPairingOpen}
          className="rounded-lg border border-border bg-background"
        >
          <CollapsibleTrigger
            disabled={isPairing}
            render={
              <Button
                variant="ghost"
                className="h-auto min-h-14 w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal sm:h-auto"
              />
            }
          >
            <LinkIcon className="size-4 text-muted-foreground" />
            <span className="flex-1">Add a computer</span>
            <ChevronRightIcon
              className={cn("size-4 text-muted-foreground", pairingOpen && "rotate-90")}
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="px-3 pb-3">
              <GuidedComputerConnection
                pairing={
                  <PairingForm
                    isPairing={isPairing}
                    setIsPairing={setIsPairing}
                    onPaired={(environmentId) => {
                      setPairingOpen(false);
                      onPaired(environmentId);
                      requestAnimationFrame(() => continueRef.current?.focus());
                    }}
                  />
                }
                disabled={isPairing}
                onBusyChange={setIsPairing}
                onConnected={onPaired}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </div>
      <div className="mt-6 flex items-center justify-end gap-3">
        <Button
          ref={continueRef}
          autoFocus={!expandPairingInitially}
          disabled={!ready || isPairing}
          onClick={onContinue}
        >
          Continue
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </>
  );
}

function ConnectAccountOption({
  autoSelectedComputers,
  disabled,
  selectedIds,
  onToggleEnvironment,
}: {
  readonly autoSelectedComputers: Set<EnvironmentId>;
  readonly disabled: boolean;
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onToggleEnvironment: (environmentId: EnvironmentId, checked: boolean) => void;
}) {
  const { environments } = useEnvironments();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const [expanded, setExpanded] = useState(true);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const onDiscoveryReady = useCallback(() => setDiscoveryReady(true), []);

  return (
    <Collapsible
      open={expanded && !!isSignedIn && discoveryReady}
      onOpenChange={setExpanded}
      className="rounded-lg border border-border bg-background"
    >
      <CollapsibleTrigger
        disabled={disabled || !isLoaded}
        onClick={(event) => {
          if (!isSignedIn) {
            event.preventDefault();
            setExpanded(true);
            openAuthPrompt();
          }
        }}
        render={
          <Button
            variant="ghost"
            className="h-auto min-h-14 w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal sm:h-auto"
          />
        }
      >
        <CloudIcon className="size-4 text-muted-foreground" />
        <span className="flex-1">C0CODE Connect</span>
        <span className="text-xs text-muted-foreground">
          {!isLoaded
            ? "Loading sign-in…"
            : !isSignedIn
              ? "Sign in"
              : !discoveryReady
                ? "Loading computers…"
                : null}
        </span>
        <ChevronRightIcon
          className={cn("size-4 text-muted-foreground", expanded && isSignedIn && "rotate-90")}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel keepMounted>
        <div className="px-3 pb-3">
          <div className="mb-3 space-y-1.5">
            {isSignedIn ? (
              <CloudEnvironmentConnectRows
                primaryEnvironmentId={null}
                savedEnvironments={environments}
                showSavedEnvironments
                onDiscoveryReady={onDiscoveryReady}
                selection={{ selectedIds, onChange: onToggleEnvironment, autoSelectedComputers }}
                refreshWhileEmpty
                empty={
                  <p className="py-3 text-sm text-muted-foreground">No computers linked yet.</p>
                }
              />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Open C0CODE on each computer and sign in to the same connection account.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Keep C0CODE running. Select the computers you want to set up above.
          </p>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

// ── Step 2′: Direct pairing ──────────────────────────────────

/**
 * Register a computer in this browser using a server-minted pairing link.
 */
function PairingForm({
  isPairing,
  setIsPairing,
  onPaired,
}: {
  readonly isPairing: boolean;
  readonly setIsPairing: (value: boolean) => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const connectPairingEnvironment = useAtomCommand(connectPairing, { reportFailure: false });
  const [pairingUrl, setPairingUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async () => {
    if (isPairing || pairingUrl.trim().length === 0) return;
    setIsPairing(true);
    setErrorMessage("");
    const result = await connectPairingEnvironment({ pairingUrl: pairingUrl.trim() });
    if (!mountedRef.current) return;
    setIsPairing(false);
    if (result._tag === "Success") {
      onPaired(result.value);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const cause = squashAtomCommandFailure(result);
    setErrorMessage(cause instanceof Error ? cause.message : "Pairing failed.");
  };

  return (
    <>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className="block text-sm text-muted-foreground" htmlFor="onboarding-pairing-url">
            Pairing link
          </label>
          <Input
            id="onboarding-pairing-url"
            autoFocus
            aria-invalid={errorMessage.length > 0}
            aria-describedby={errorMessage ? "onboarding-pairing-error" : undefined}
            className="mt-2"
            size="lg"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            nativeInput
            readOnly={isPairing}
            placeholder="https://your-server:5230/pair#token=…"
            value={pairingUrl}
            onChange={(event) => setPairingUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.nativeEvent.isComposing || event.keyCode === 229)
              ) {
                event.preventDefault();
              }
            }}
          />
        </div>
        {errorMessage ? (
          <div
            id="onboarding-pairing-error"
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}
        <Collapsible>
          <div className="flex items-center justify-between gap-3">
            <CollapsibleTrigger
              type="button"
              className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronRightIcon className="size-3.5 group-data-panel-open:rotate-90" />
              Need a pairing link?
            </CollapsibleTrigger>
            <Button type="submit" disabled={isPairing || pairingUrl.trim().length === 0}>
              {isPairing ? "Pairing..." : "Pair"}
            </Button>
          </div>
          <CollapsiblePanel className="pt-3">
            <p className="text-sm text-muted-foreground">
              On the other computer, open C0CODE → Settings → Connections and create a pairing link.
              Paste it above. Both computers must be able to reach each other over your network or
              VPN.
            </p>
          </CollapsiblePanel>
        </Collapsible>
      </form>
    </>
  );
}

// ── Step 3: agents ───────────────────────────────────────────
