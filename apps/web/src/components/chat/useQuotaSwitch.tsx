import type {
  EnvironmentId,
  ProviderSwitchCandidate,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import {
  automaticSwitchCandidate,
  isQuotaExhausted,
  quotaRemaining,
} from "@t3tools/shared/providerSwitch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverDescription } from "../ui/popover";
import { LimitWindows, ResetCredits } from "../usage/UsageLimits";

interface RequestState {
  readonly provider: ServerProvider;
  readonly candidates: readonly ProviderSwitchCandidate[];
  readonly pending: boolean;
  readonly error: string | null;
}

/** Resolves only the pending send; closing or navigating leaves its draft intact. */
export function useQuotaSwitch(environmentId: EnvironmentId, threadId: ThreadId) {
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const discover = useAtomCommand(serverEnvironment.switchCandidates, { reportFailure: false });
  const anchorRef = useRef<HTMLDivElement>(null);
  const resolveRef = useRef<((value: ProviderSwitchCandidate | null) => void) | null>(null);
  const generation = useRef(0);
  const rejectedAccounts = useRef(new Set<string>());
  const [request, setRequest] = useState<RequestState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo: () => void } | null>(null);
  const announce = useCallback((text: string, undo: () => void) => setNotice({ text, undo }), []);
  const finish = useCallback((value: ProviderSwitchCandidate | null) => {
    generation.current += 1;
    resolveRef.current?.(value);
    resolveRef.current = null;
    setRequest(null);
  }, []);
  useEffect(() => {
    setRequest(null);
    setNotice(null);
    rejectedAccounts.current.clear();
    return () => {
      generation.current += 1;
      resolveRef.current?.(null);
      resolveRef.current = null;
    };
  }, [environmentId, threadId]);

  const check = useCallback(
    async (
      provider: ServerProvider,
      failedTurn = false,
    ): Promise<ProviderSwitchCandidate | null | undefined> => {
      if (
        settings.usageLimitSwitch === "off" ||
        (!failedTurn && !isQuotaExhausted(provider.usageLimits, Date.now()))
      )
        return undefined;
      // A second Enter must not resolve or replace the first pending send.
      if (resolveRef.current) return null;
      if (failedTurn) rejectedAccounts.current.add(provider.instanceId);
      else rejectedAccounts.current.clear();
      const revision = ++generation.current;
      const answer = new Promise<ProviderSwitchCandidate | null>((resolve) => {
        resolveRef.current = resolve;
      });
      setSelectedId(null);
      setRequest({ provider, candidates: [], pending: true, error: null });
      void (async () => {
        const result = await discover({
          environmentId,
          input: { threadId, instanceId: provider.instanceId },
        });
        if (revision !== generation.current) return;
        if (result._tag !== "Success") {
          setRequest({
            provider,
            candidates: [],
            pending: false,
            error: "Could not check other accounts. Your message has not been sent.",
          });
          return;
        }
        const best = automaticSwitchCandidate(
          result.value.filter((candidate) => !rejectedAccounts.current.has(candidate.instanceId)),
          Date.now(),
        );
        if (settings.usageLimitSwitch === "auto" && best) finish(best);
        else {
          setSelectedId(best?.instanceId ?? null);
          setRequest({ provider, candidates: result.value, pending: false, error: null });
        }
      })().catch((error: unknown) => {
        console.error(
          "[quota-switch] Account discovery failed",
          error instanceof Error ? error.message : "Unknown error",
        );
        if (revision === generation.current)
          setRequest({
            provider,
            candidates: [],
            pending: false,
            error: "Could not check other accounts. Your message has not been sent.",
          });
      });
      return answer;
    },
    [discover, environmentId, threadId, settings.usageLimitSwitch, finish],
  );

  const selected = request?.candidates.find((candidate) => candidate.instanceId === selectedId);
  const now = Date.now();
  const exhausted = request?.provider.usageLimits?.windows.find(
    (window) => window.usedPercent >= 100,
  );
  const reset = exhausted?.resetsAt ? new Date(exhausted.resetsAt) : null;
  const resetLabel =
    reset && Number.isFinite(reset.getTime())
      ? reset.toLocaleString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const dialog = (
    <Popover
      modal
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <PopoverPopup
        anchor={anchorRef}
        side="top"
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] bg-popover"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            selected &&
            !request?.pending &&
            !(event.target instanceof HTMLElement && event.target.closest("button,input"))
          ) {
            event.preventDefault();
            finish(selected);
          }
        }}
      >
        <div className="flex flex-col gap-3">
          <PopoverTitle className="text-sm">
            {request?.provider.displayName ?? request?.provider.instanceId} reached its{" "}
            {exhausted?.kind === "weekly" ? "weekly " : ""}limit
          </PopoverTitle>
          <PopoverDescription className="text-xs">
            {resetLabel ? `Resets ${resetLabel}. ` : ""}Choose an account to continue. Your draft is
            preserved.
          </PopoverDescription>
          {request?.pending ? (
            <p role="status" className="text-xs text-muted-foreground">
              Checking accounts…
            </p>
          ) : null}
          {request?.error ? (
            <p role="alert" className="text-xs text-destructive">
              {request.error}
            </p>
          ) : null}
          <div
            className="flex max-h-64 flex-col gap-2 overflow-y-auto"
            role="radiogroup"
            aria-label="Available accounts"
          >
            {request?.candidates.map((candidate) => {
              const remaining = quotaRemaining(candidate.usageLimits, now);
              const selectable =
                candidate.enabled &&
                candidate.keepsConversation &&
                remaining !== null &&
                remaining > 0;
              return (
                <div
                  key={candidate.instanceId}
                  className="flex flex-col gap-1 rounded-md border border-border p-2 text-xs has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-accent"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selectedId === candidate.instanceId}
                    disabled={!selectable}
                    key={candidate.instanceId}
                    onClick={() => setSelectedId(candidate.instanceId)}
                    className="flex w-full flex-col gap-1 rounded-sm text-left text-xs disabled:opacity-60"
                  >
                    <span className="font-medium wrap-anywhere">{candidate.displayName}</span>
                    <span className="text-muted-foreground">
                      {candidate.keepsConversation
                        ? "Keeps this conversation"
                        : "Starts a new thread"}
                      {candidate.enabled ? "" : " · Disabled; enable in Settings"}
                    </span>
                  </button>
                  {candidate.usageLimits && !candidate.usageLimits.unavailable ? (
                    <LimitWindows
                      compact
                      driver={candidate.driver}
                      windows={candidate.usageLimits.windows}
                      now={now}
                    />
                  ) : (
                    <span>Quota unavailable</span>
                  )}
                </div>
              );
            })}
          </div>
          {!request?.pending && !request?.error && !selected ? (
            <p className="text-xs text-muted-foreground">
              No enabled account with confirmed capacity can keep this conversation.
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={settings.usageLimitSwitch === "auto"}
              onChange={(event) =>
                updateSettings({ usageLimitSwitch: event.target.checked ? "auto" : "ask" })
              }
            />
            Always switch automatically between compatible accounts
          </label>
          {request?.provider.usageLimits?.resetCredits ? (
            <ResetCredits
              environmentId={environmentId}
              input={{ instanceId: request.provider.instanceId }}
              credits={request.provider.usageLimits.resetCredits}
              now={now}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => finish(null)}>
              Wait for reset
            </Button>
            <Button
              size="sm"
              disabled={!selected || request?.pending}
              onClick={() => {
                if (selected) finish(selected);
              }}
            >
              {selected ? `Continue on ${selected.displayName}` : "Continue"}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
  return {
    check,
    anchorRef,
    dialog,
    notice: notice?.text ?? null,
    announce,
    undo: () => {
      notice?.undo();
      setNotice(null);
    },
    dismissNotice: () => setNotice(null),
  };
}
