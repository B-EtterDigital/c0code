import {
  ArrowUpRightIcon,
  EllipsisIcon,
  ListTodoIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  dispatchFluidQueueEntry,
  FLUID_QUEUE_DISPATCH_START_TIMEOUT_MS,
  fluidQueueEntryLabel,
  hydrateFluidQueueEntry,
  reconcileFluidQueuePhase,
  removeFluidQueueEntry,
  setFluidQueueEnabled,
  type FluidQueueEntry,
  useFluidQueueState,
} from "../../c0x/fluidQueue";
import { postC0xShellEvent } from "../../c0x/nativeShell";
import type { SessionPhase } from "../../types";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";

import "./FluidQueueRows.css";

interface FluidQueueRowsProps {
  threadKey: string;
  phase: SessionPhase;
  onDispatch: (entry: FluidQueueEntry) => Promise<boolean>;
  onEdit: (entry: FluidQueueEntry) => Promise<boolean>;
  onOpenInSideChat: (entry: FluidQueueEntry) => Promise<boolean>;
  onDelete: (entry: FluidQueueEntry, draft: ReturnType<typeof hydrateFluidQueueEntry>) => void;
}

function reportActionError(operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  postC0xShellEvent({ type: "fluid-queue-error", operation, message });
}

export function FluidQueueRows(props: FluidQueueRowsProps) {
  const state = useFluidQueueState();
  const [refusedAutomaticEntryId, setRefusedAutomaticEntryId] = useState<string | null>(null);
  const entries = useMemo(
    () => state.entries.filter((entry) => entry.threadKey === props.threadKey),
    [props.threadKey, state.entries],
  );
  const claim = state.claimsByThreadKey[props.threadKey] ?? null;

  useEffect(() => {
    reconcileFluidQueuePhase(props.threadKey, props.phase === "running");
    if (props.phase !== "ready" || !claim || claim.sawRunning) return;
    const remaining = claim.startedAt + FLUID_QUEUE_DISPATCH_START_TIMEOUT_MS - Date.now();
    const timeout = window.setTimeout(
      () => reconcileFluidQueuePhase(props.threadKey, false),
      Math.max(0, remaining) + 1,
    );
    return () => window.clearTimeout(timeout);
  }, [claim, props.phase, props.threadKey]);

  useEffect(() => {
    const first = entries[0];
    if (
      !state.enabled ||
      props.phase !== "ready" ||
      !first ||
      claim ||
      refusedAutomaticEntryId === first.id
    ) {
      return;
    }
    void dispatchFluidQueueEntry({
      threadKey: props.threadKey,
      mode: "automatic",
      dispatch: props.onDispatch,
    }).then((result) => {
      if (result === "refused") setRefusedAutomaticEntryId(first.id);
    });
  }, [
    claim,
    entries,
    props.onDispatch,
    props.phase,
    props.threadKey,
    refusedAutomaticEntryId,
    state.enabled,
  ]);

  if (entries.length === 0 && state.enabled) return null;

  const edit = async (entry: FluidQueueEntry) => {
    try {
      if (await props.onEdit(entry)) removeFluidQueueEntry(props.threadKey, entry.id);
    } catch (error) {
      reportActionError("edit", error);
    }
  };

  const openInSideChat = async (entry: FluidQueueEntry) => {
    try {
      if (await props.onOpenInSideChat(entry)) removeFluidQueueEntry(props.threadKey, entry.id);
    } catch (error) {
      reportActionError("open-side-chat", error);
    }
  };

  const remove = (entry: FluidQueueEntry) => {
    const draft = hydrateFluidQueueEntry(entry);
    if (removeFluidQueueEntry(props.threadKey, entry.id)) props.onDelete(entry, draft);
  };

  return (
    <div
      className="c0x-fluid-queue relative z-1 mx-3 -mb-px overflow-hidden rounded-t-[18px] border border-b-0 border-black/10 bg-white dark:border-white/[0.08] dark:bg-[#292929]"
      data-testid="fluid-queue"
    >
      {entries.length === 0 ? (
        <div className="c0x-fluid-queue-row flex h-8 min-w-0 items-center gap-1.5 px-2 text-xs text-foreground dark:text-white">
          <ListTodoIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground dark:text-white/45"
          />
          <span className="min-w-0 flex-1 truncate">Fluid queue is off</span>
          <button
            type="button"
            className="inline-flex h-6 shrink-0 items-center rounded-md px-1.5 text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={() => setFluidQueueEnabled(true)}
          >
            Turn on
          </button>
        </div>
      ) : (
        entries.map((entry, index) => {
          const dispatching = claim?.entryId === entry.id;
          return (
            <div
              key={entry.id}
              className="c0x-fluid-queue-row flex h-8 min-w-0 items-center gap-1.5 px-2 text-xs text-foreground dark:text-white"
              data-dispatching={dispatching || undefined}
            >
              <ListTodoIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground dark:text-white/45"
              />
              <span className="min-w-0 flex-1 truncate">{fluidQueueEntryLabel(entry)}</span>
              <button
                type="button"
                className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
                disabled={dispatching}
                onClick={() => {
                  void dispatchFluidQueueEntry({
                    threadKey: props.threadKey,
                    entryId: entry.id,
                    mode: "steer",
                    dispatch: props.onDispatch,
                  });
                }}
              >
                <span>Steer</span>
                <ArrowUpRightIcon aria-hidden="true" className="size-3" />
              </button>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white"
                      aria-label={`Delete queued message ${index + 1}`}
                      disabled={dispatching}
                      onClick={() => remove(entry)}
                    />
                  }
                >
                  <Trash2Icon aria-hidden="true" className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup>Delete queued message</TooltipPopup>
              </Tooltip>
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-black/10 text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                      aria-label={`More actions for queued message ${index + 1}`}
                      disabled={dispatching}
                    />
                  }
                >
                  <EllipsisIcon aria-hidden="true" className="size-3.5" />
                </MenuTrigger>
                <MenuPopup
                  align="end"
                  side="top"
                  className="min-w-44 rounded-xl bg-popover dark:border-white/10 dark:bg-[#292929]"
                  {...composerFloatingLayerProps}
                >
                  <MenuItem
                    className="dark:data-highlighted:bg-white/10"
                    onClick={() => void edit(entry)}
                  >
                    <PencilIcon />
                    Edit message
                  </MenuItem>
                  <MenuItem
                    className="dark:data-highlighted:bg-white/10"
                    onClick={() => void openInSideChat(entry)}
                  >
                    <MessageSquarePlusIcon />
                    Open in side chat
                  </MenuItem>
                  <MenuItem
                    className="dark:data-highlighted:bg-white/10"
                    onClick={() => setFluidQueueEnabled(!state.enabled)}
                  >
                    <ListTodoIcon />
                    {state.enabled ? "Turn off queuing" : "Turn on queuing"}
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </div>
          );
        })
      )}
    </div>
  );
}
