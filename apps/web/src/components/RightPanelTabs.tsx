import type {
  ContextMenuItem,
  EnvironmentId,
  PreviewSessionSnapshot,
  ProjectId,
  PullRequestState,
} from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDiff,
  Files,
  GitPullRequest,
  Globe2,
  Plus,
  TerminalSquare,
  Volume2,
  VolumeOff,
  type LucideIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useBrowserDefaults } from "~/browser/browserDefaults";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { FaviconImage } from "./preview/PreviewFaviconIcon";
import { previewBridge } from "./preview/previewBridge";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
// C0X patch: C0VIBE modules and SMARCH controls join the panel natively.
import { c0xModuleById, useC0xShellConfig } from "~/c0x/nativeShell";
import { C0xSmarchSection } from "./c0x/C0xSmarchSection";
import { c0xModuleIcon } from "./c0x/c0xModuleIcons";

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  open?: boolean;
  /** Forwarded to PreviewPanelShell so this surface persists its own width. */
  widthStorageKey?: string;
  /** Forwarded to PreviewPanelShell as the initial width before a user resize. */
  defaultWidth?: number;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  /** Fallback environment for surfaces that do not carry their own. */
  environmentId: EnvironmentId | null;
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  /**
   * Maps a server session tab id to the desktop runtime tab id the Electron
   * preview manager is keyed by. Session ids are only unique within one server
   * process, so desktop operations must not be addressed with them.
   */
  previewRuntimeTabId?: ((tabId: string) => string) | undefined;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onMoveSurface?: (surface: RightPanelSurface, toIndex: number) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: () => void;
  /**
   * Separate from `onAddBrowser` on purpose: that one is passed directly as a
   * DOM click handler, and a `(profileId?: string)` signature would silently
   * accept the MouseEvent as a profile id.
   */
  onAddBrowserInProfile: (profileId: string) => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddAgents: () => void;
  /**
   * C0X patch: open one C0VIBE module (from the shell-pushed registry).
   * Optional — surfaces without a thread scope (the pull-request list's
   * shared panel) leave it out and the module entries stay hidden there.
   */
  onOpenC0xModule?: (moduleId: string) => void;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  agentsAvailable: boolean;
  pullRequestStatusSeeds?: Readonly<Record<string, PullRequestTabStatusSeed>>;
  /** Running + waiting subagents; badges the Agents card in the empty state. */
  liveAgentCount: number;
  children: ReactNode;
}

export interface PullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

export type PullRequestTabStatusSeed = Pick<PullRequestTabStatus, "state" | "isDraft">;

export function shouldOpenDefaultBrowserProfileFromMenuClick(
  pointerType: string | undefined,
): boolean {
  return pointerType !== "touch";
}

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the T3 Code desktop app.",
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
  pullRequest: "This thread's branch has no pull request yet.",
  agents: "Agents are only available from a thread.",
} as const;

/** Overlays that must win over the launcher's letter shortcuts. */
const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  '[data-slot="dialog-popup"]',
  '[data-slot="alert-dialog-popup"]',
  '[data-slot="command-dialog-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

/** One-line unavailability hints for the empty-state cards. */
const SURFACE_UNAVAILABLE_HINTS = {
  browser: "Only available in the desktop app.",
  terminal: "Available when a project is open.",
  files: "Available when a project is open.",
  diff: "Available for Git repositories.",
  pullRequest: "No pull request on this branch yet.",
  agents: "Available from a thread.",
} as const;

type TabContextMenuAction =
  | "copy-path"
  | "toggle-mute"
  | "move-left"
  | "move-right"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all";

const TAB_SCROLL_EDGE_TOLERANCE = 1;

function tabScrollViewport(root: HTMLDivElement | null): HTMLDivElement | null {
  return root?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null;
}

/**
 * Desktop preview tab backing a surface, or null for non-preview surfaces, the
 * "new browser tab" placeholder, and the web build where no desktop tab exists.
 */
function previewTabIdOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string | null {
  if (surface.kind !== "preview" || !surface.resourceId) return null;
  return sessions[surface.resourceId]?.tabId ?? null;
}

/**
 * Label and enabled state for a preview tab's mute menu entry.
 * Stays disabled until desktop overlay state arrives: a server session id can
 * resolve while the preview manager's createTab is still in flight, and muting
 * then fails with a PreviewTabNotFoundError nothing surfaces to the user.
 */
export function tabMuteMenuItem(input: {
  overlay: DesktopPreviewOverlay | null;
  canResolveRuntimeTabId: boolean;
}): { label: string; disabled: boolean } {
  const muted = input.overlay?.audioMuted ?? false;
  return {
    label: muted ? "Unmute tab" : "Mute tab",
    disabled: input.overlay === null || !input.canResolveRuntimeTabId,
  };
}

type TabAudioState = "none" | "audible" | "muted";

/**
 * A muted tab that is not making sound shows nothing: mute is armed silently,
 * and the indicator only appears once there is audio to speak of.
 */
function tabAudioState(overlay: DesktopPreviewOverlay | null): TabAudioState {
  if (!overlay?.audible) return "none";
  return overlay.audioMuted ? "muted" : "audible";
}

type SurfaceShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey"
>;

export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return (
    actions.find(
      (action) => action.available && action.shortcut.toLowerCase() === event.key.toLowerCase(),
    ) ?? null
  );
}

/**
 * A focused editable is a typing context whether or not it has text yet: an
 * empty chat composer at rest is still where the user's next keystrokes are
 * meant to land, and claiming launcher letters from it would redirect prompts
 * into whatever surface opens. The `:not` clause lets `closest` see past
 * non-editable islands (`contenteditable="false"`) to an editable host around
 * them, matching ComposerPendingUserInputPanel's typing guard.
 */
export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

export const TAB_DRAG_THRESHOLD_PX = 4;

export interface TabDragRect {
  id: string;
  left: number;
  right: number;
  width: number;
}

export interface TabDragState {
  pointerId: number;
  surfaceId: string;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  fromIndex: number;
  toIndex: number;
  dragging: boolean;
  settling: boolean;
  rects: readonly TabDragRect[];
}

function dragTargetIndex(drag: TabDragState): number {
  const draggedRect = drag.rects[drag.fromIndex];
  if (!draggedRect) return drag.fromIndex;
  const draggedCenter = draggedRect.left + draggedRect.width / 2 + drag.pointerX - drag.startX;
  let targetIndex = 0;
  for (const [index, rect] of drag.rects.entries()) {
    if (draggedCenter >= (rect.left + rect.right) / 2) targetIndex = index;
  }
  return targetIndex;
}

export function updateTabDragPointer(
  current: TabDragState,
  pointerX: number,
  pointerY: number,
): TabDragState {
  const dragging =
    current.dragging ||
    Math.hypot(pointerX - current.startX, pointerY - current.startY) >= TAB_DRAG_THRESHOLD_PX;
  const next = { ...current, pointerX, pointerY, dragging };
  return { ...next, toIndex: dragging ? dragTargetIndex(next) : next.fromIndex };
}

export type TabPointerRelease =
  | { kind: "activate"; drag: TabDragState }
  | { kind: "move"; drag: TabDragState; toIndex: number };

export function resolveTabPointerRelease(
  current: TabDragState,
  pointerX: number,
  pointerY: number,
): TabPointerRelease {
  const drag = updateTabDragPointer(current, pointerX, pointerY);
  return drag.dragging ? { kind: "move", drag, toIndex: drag.toIndex } : { kind: "activate", drag };
}

export function keyboardTabMoveIndex(
  key: string,
  altKey: boolean,
  surfaceIndex: number,
  surfaceCount: number,
): number | null {
  if (!altKey || (key !== "ArrowLeft" && key !== "ArrowRight")) return null;
  const toIndex = surfaceIndex + (key === "ArrowLeft" ? -1 : 1);
  return toIndex >= 0 && toIndex < surfaceCount ? toIndex : null;
}

function tabDragTransform(surfaceId: string, drag: TabDragState | null): number {
  if (!drag) return 0;
  const originalIndex = drag.rects.findIndex((rect) => rect.id === surfaceId);
  const draggedRect = drag.rects[drag.fromIndex];
  if (originalIndex < 0 || !draggedRect) return 0;
  if (surfaceId === drag.surfaceId) {
    if (!drag.settling) return drag.pointerX - drag.startX;
    const targetRect = drag.rects[drag.toIndex];
    if (!targetRect) return 0;
    return drag.toIndex > drag.fromIndex
      ? targetRect.right - draggedRect.right
      : targetRect.left - draggedRect.left;
  }
  const gap = Math.max(0, (drag.rects[1]?.left ?? draggedRect.right) - drag.rects[0]!.right);
  const shift = draggedRect.width + gap;
  if (
    drag.toIndex > drag.fromIndex &&
    originalIndex > drag.fromIndex &&
    originalIndex <= drag.toIndex
  ) {
    return -shift;
  }
  if (
    drag.toIndex < drag.fromIndex &&
    originalIndex >= drag.toIndex &&
    originalIndex < drag.fromIndex
  ) {
    return shift;
  }
  return 0;
}

/**
 * C0X patch: the launcher's card shape, widened from the `as const` surface
 * array so shell-pushed C0VIBE modules can join the same grid grammar.
 * Modules carry no letter shortcut (the surface letters are taken).
 */
interface LauncherAction {
  label: string;
  description: string;
  icon: LucideIcon;
  shortcut: string;
  available: boolean;
  disabledReason: string;
  onClick: () => void;
  badgeCount: number;
  /** C0X modules replace their duplicate glyph + title with this wordmark. */
  mark: string | null;
}

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
      aria-keyshortcuts={props.shortcut}
    >
      {props.children}
      <MenuShortcut>{props.shortcut}</MenuShortcut>
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

/**
 * Card launcher shown when the right panel has no surfaces. Keyboard-first
 * without palette chrome: a surface's letter opens it directly from anywhere
 * outside a typing context, and arrows plus Enter work while the launcher is
 * focused. The highlight only appears on hover or arrow use. Unavailable
 * surfaces stay visible with a one-line reason.
 */
function RightPanelEmptyState(props: {
  onAddBrowser: () => void;
  onAddBrowserInProfile: (profileId: string) => void;
  browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddAgents: () => void;
  onOpenC0xModule: ((moduleId: string) => void) | null;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  agentsAvailable: boolean;
  liveAgentCount: number;
}) {
  // -1 means no highlight: it only appears on hover or arrow use.
  const [highlight, setHighlight] = useState(-1);

  const actions = [
    {
      label: "Browser",
      description: "Open a local app or URL.",
      icon: Globe2,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.browser,
      onClick: props.onAddBrowser,
      badgeCount: 0,
      mark: null,
    },
    {
      label: "Terminal",
      description: "Start a shell in this workspace.",
      icon: TerminalSquare,
      shortcut: "T",
      available: props.terminalAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.terminal,
      onClick: props.onAddTerminal,
      badgeCount: 0,
      mark: null,
    },
    {
      label: "Files",
      description: "Browse and read workspace files.",
      icon: Files,
      shortcut: "F",
      available: props.filesAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.files,
      onClick: props.onAddFiles,
      badgeCount: 0,
      mark: null,
    },
    {
      label: "Diff",
      description: "Review changes in this thread.",
      icon: FileDiff,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.diff,
      onClick: props.onAddDiff,
      badgeCount: 0,
      mark: null,
    },
    {
      label: "Pull request",
      description: "Open this branch's pull request.",
      icon: GitPullRequest,
      shortcut: "P",
      available: props.pullRequestAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.pullRequest,
      onClick: props.onAddPullRequest,
      badgeCount: 0,
      mark: null,
    },
    {
      label: "Agents",
      description: "Follow subagents and workflows.",
      icon: Bot,
      shortcut: "A",
      available: props.agentsAvailable,
      disabledReason: SURFACE_UNAVAILABLE_HINTS.agents,
      onClick: props.onAddAgents,
      badgeCount: props.liveAgentCount,
      mark: null,
    },
  ] as const;

  // C0X patch: C0VIBE modules join the launcher as native peer tiles, and the
  // SMARCH controls section rides above the heading — both shell-pushed, so a
  // standalone browser (no shell config) renders exactly upstream.
  const shellConfig = useC0xShellConfig();
  const openC0xModule = props.onOpenC0xModule;
  const moduleActions: LauncherAction[] = openC0xModule
    ? shellConfig.modules.map((module) => ({
        label: module.title,
        description: module.blurb,
        icon: c0xModuleIcon(module.icon),
        shortcut: "",
        available: module.available,
        disabledReason: module.disabledReason,
        onClick: () => openC0xModule(module.id),
        badgeCount: 0,
        mark: module.mark,
      }))
    : [];
  const surfaceActions: readonly LauncherAction[] = actions;
  const hasShellContent = shellConfig.smarch !== null || moduleActions.length > 0;

  const availableActions = [...surfaceActions, ...moduleActions].filter(
    (action) => action.available,
  );
  const highlightIndex =
    availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1);

  // Letter shortcuts work while the launcher is visible, not only while it
  // is focused; focus moves around too easily (stray clicks) to carry them.
  // Capture phase so app-level key handlers cannot swallow the event first;
  // typing contexts and already-handled events are left alone.
  const shortcutActionsRef = useRef(availableActions);
  useEffect(() => {
    shortcutActionsRef.current = availableActions;
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = surfaceShortcutActionForKey(shortcutActionsRef.current, event);
      if (!action) return;
      if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
      const target = event.target;
      if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
      event.preventDefault();
      event.stopPropagation();
      action.onClick();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (availableActions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % availableActions.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight(
        highlightIndex === -1
          ? availableActions.length - 1
          : (highlightIndex - 1 + availableActions.length) % availableActions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      // A focused card button owns its own activation; only open from the
      // highlight when the container itself has focus.
      if (event.target instanceof HTMLElement && event.target.closest("button")) return;
      const action = availableActions[highlightIndex];
      if (!action) return;
      event.preventDefault();
      action.onClick();
    }
  };

  // Stable identity so React only runs this callback ref on mount/unmount;
  // an inline arrow would re-attach and re-focus on every render.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);

  const isHighlighted = (action: LauncherAction) =>
    highlightIndex !== -1 && availableActions[highlightIndex] === action;

  const actionIcon = (action: LauncherAction, iconClassName = "size-4") => {
    const Icon = action.icon;
    return (
      <span className="relative inline-flex shrink-0">
        <Icon className={iconClassName} />
        {action.badgeCount > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-[9px] font-semibold tabular-nums text-white"
          >
            {action.badgeCount}
          </span>
        ) : null}
      </span>
    );
  };

  const cardShellClass =
    "rounded-lg border border-border/80 bg-card dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5";
  const highlightedCardClass = "bg-accent/60 dark:inset-ring-white/20";

  const renderAction = (action: LauncherAction) =>
    action.available ? (
      <button
        key={action.label}
        type="button"
        onClick={action.onClick}
        onMouseEnter={() => setHighlight(availableActions.indexOf(action))}
        onMouseLeave={() =>
          setHighlight((current) => (current === availableActions.indexOf(action) ? -1 : current))
        }
        className={cn(
          "relative flex w-full cursor-pointer flex-col items-start p-4 text-left transition hover:border-border hover:bg-accent/60",
          cardShellClass,
          isHighlighted(action) && highlightedCardClass,
        )}
      >
        {action.shortcut ? <Kbd className="absolute top-3 right-3">{action.shortcut}</Kbd> : null}
        {action.mark ? (
          <img
            src={action.mark}
            alt={action.label}
            className="h-3.5 w-auto max-w-full object-contain"
          />
        ) : (
          <span className="flex items-center gap-2 pe-8">
            {actionIcon(action)}
            <span className="font-medium text-sm">{action.label}</span>
          </span>
        )}
        <span className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
          {action.description}
        </span>
      </button>
    ) : (
      <div
        key={action.label}
        className={cn("relative flex w-full flex-col items-start p-4 opacity-40", cardShellClass)}
      >
        {action.shortcut ? <Kbd className="absolute top-3 right-3">{action.shortcut}</Kbd> : null}
        {action.mark ? (
          <img
            src={action.mark}
            alt={action.label}
            className="h-3.5 w-auto max-w-full object-contain"
          />
        ) : (
          <span className="flex items-center gap-2 pe-8">
            {actionIcon(action)}
            <span className="font-medium text-sm">{action.label}</span>
          </span>
        )}
        <span className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
          {action.disabledReason}
        </span>
      </div>
    );

  const surfaceCards = (
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) =>
            action.available ? (
              // The card is itself a button, so the profile chooser sits beside
              // it in a wrapper rather than inside it. Hover lives on the
              // wrapper: the chooser overlays the card, and a pointer moving
              // onto it must not read as leaving the card.
              <div
                key={action.label}
                className="group relative"
                onMouseEnter={() => setHighlight(availableActions.indexOf(action))}
                onMouseLeave={() =>
                  setHighlight((current) =>
                    current === availableActions.indexOf(action) ? -1 : current,
                  )
                }
              >
                <button
                  type="button"
                  onClick={action.onClick}
                  className={cn(
                    // Full height: the wrapper is the grid item that stretches
                    // to the row, so the button must fill it to stay level with
                    // its neighbour and keep the chooser anchored inside.
                    "relative flex h-full w-full cursor-pointer flex-col items-start p-4 text-left transition group-hover:border-border group-hover:bg-accent/60",
                    cardShellClass,
                    isHighlighted(action) && highlightedCardClass,
                  )}
                >
                  <Kbd className="absolute top-3 right-3">{action.shortcut}</Kbd>
                  <span className="flex items-center gap-2 pe-8">
                    {actionIcon(action)}
                    <span className="font-medium text-sm">{action.label}</span>
                  </span>
                  <span className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
                    {action.description}
                  </span>
                </button>
                {/*
                  Same choice the tab bar's "+" menu offers: the card opens the
                  default profile, the chevron picks another. Only worth showing
                  once there is something to choose between.
                */}
                {action.label === "Browser" && props.browserProfiles.length > 1 ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          aria-label="Open browser in a profile"
                          className="absolute right-3 bottom-3 [--control-icon-color:currentColor]"
                          size="icon-xs"
                          variant="ghost-muted"
                        />
                      }
                    >
                      <ChevronDown className="size-3.5" />
                    </MenuTrigger>
                    <MenuPopup
                      align="end"
                      side="bottom"
                      sideOffset={6}
                      className="min-w-40 max-w-56"
                    >
                      {props.browserProfiles.map((profile) => (
                        <MenuItem
                          key={profile.id}
                          onClick={() => props.onAddBrowserInProfile(profile.id)}
                        >
                          <span className="min-w-0 truncate">{profile.name}</span>
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                ) : null}
              </div>
            ) : (
              <div
                key={action.label}
                className={cn(
                  "relative flex w-full flex-col items-start p-4 opacity-40",
                  cardShellClass,
                )}
              >
                <Kbd className="absolute top-3 right-3">{action.shortcut}</Kbd>
                <span className="flex items-center gap-2 pe-8">
                  {actionIcon(action)}
                  <span className="font-medium text-sm">{action.label}</span>
                </span>
                <span className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
                  {action.disabledReason}
                </span>
              </div>
            ),
          )}
        </div>
  );

  const launcherHeading = (
    <>
      <h3 className="font-medium text-foreground text-sm">Open a surface</h3>
      <p className="mt-1 text-muted-foreground text-xs">Choose what to show in the right panel.</p>
    </>
  );

  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Open a surface"
      data-surface-launcher-keys={availableActions.map((action) => action.shortcut).join("")}
      className={cn(
        "flex min-h-0 flex-1 overflow-y-auto px-6 pt-6 outline-none",
        // C0X patch: with shell sections the column top-anchors and scrolls
        // (my-auto below still centers it while it fits); upstream keeps its
        // centered layout untouched.
        hasShellContent ? "flex-col items-center" : "items-center justify-center",
        // The panel topbar sits above this container; matching bottom padding
        // keeps the cards centered against the full panel, not the leftover.
        "pb-[calc(var(--workspace-topbar-height)+--spacing(6))]",
      )}
    >
      {hasShellContent ? (
        <div className="flex min-h-full w-full max-w-lg shrink-0 flex-col gap-6" data-c0x-launcher-sections>
          {shellConfig.smarch ? (
            <div className="shrink-0" data-c0x-launcher-section="smarch">
              <C0xSmarchSection smarch={shellConfig.smarch} />
            </div>
          ) : null}
          <div className="flex flex-1 flex-col justify-center" data-c0x-launcher-section="surfaces">
            <div className="mb-5 text-center">{launcherHeading}</div>
            {surfaceCards}
          </div>
          {moduleActions.length > 0 ? (
            <div className="shrink-0" data-c0x-launcher-section="modules">
              <h3 className="font-medium text-foreground text-sm">C0VIBE modules</h3>
              <div className="mt-2 grid grid-cols-2 gap-2">{moduleActions.map(renderAction)}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="relative w-full max-w-lg">
          <div className="absolute inset-x-0 bottom-full mb-5 text-center">{launcherHeading}</div>
          {surfaceCards}
        </div>
      )}
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "c0x-module":
      // C0X patch: the shell registry names the tab; the raw id is the
      // honest fallback when a config push has not landed yet.
      return c0xModuleById(surface.moduleId)?.title ?? surface.moduleId;
    case "file":
      return surface.relativePath.slice(
        Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1,
      );
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "pull-request":
      return `#${surface.number}`;
    case "agents":
      return "Agents";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function PreviewFavicon({ capturedUrl, url }: { capturedUrl: string | null; url: string | null }) {
  const publicProviderUrl = faviconUrlForOrigin(url, 32);
  return (
    <FaviconImage
      sources={[capturedUrl, publicProviderUrl]}
      fallback={<Globe2 className="size-3 shrink-0" />}
      className="size-3 shrink-0 rounded-sm object-contain"
    />
  );
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function SurfaceIcon({
  surface,
  sessions,
  desktopByTabId,
  theme,
  environmentId,
  pullRequestStatusSeeds,
}: {
  surface: RightPanelSurface;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  theme: "light" | "dark";
  environmentId: EnvironmentId | null;
  pullRequestStatusSeeds: Readonly<Record<string, PullRequestTabStatusSeed>> | undefined;
}) {
  // C0X patch: subscribes to shell-config pushes so module tab icons (and,
  // through the shared re-render, their titles) settle once the registry lands.
  const shellConfig = useC0xShellConfig();
  switch (surface.kind) {
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      const favicon = snapshot ? (desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
      const capturedUrl =
        favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null;
      return <PreviewFavicon capturedUrl={capturedUrl} url={url} />;
    }
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "pull-request":
      return (
        <PullRequestSurfaceIcon
          surface={surface}
          environmentId={environmentId}
          seed={pullRequestStatusSeeds?.[surface.id]}
        />
      );
    case "agents":
      return <Bot className="size-3 shrink-0" />;
    case "c0x-module": {
      const module = shellConfig.modules.find((entry) => entry.id === surface.moduleId);
      const Icon = c0xModuleIcon(module?.icon);
      return <Icon className="size-3 shrink-0" />;
    }
  }
}

function PullRequestSurfaceIcon({
  surface,
  environmentId,
  seed,
}: {
  surface: Extract<RightPanelSurface, { kind: "pull-request" }>;
  environmentId: EnvironmentId | null;
  seed: PullRequestTabStatusSeed | undefined;
}) {
  const resolvedEnvironmentId =
    (surface.environmentId as EnvironmentId | undefined) ?? environmentId;
  const detail = useEnvironmentQuery(
    resolvedEnvironmentId === null
      ? null
      : pullRequestEnvironment.detail({
          environmentId: resolvedEnvironmentId,
          input: {
            projectId: surface.projectId as ProjectId,
            repository: surface.repository,
            number: surface.number,
          },
        }),
  ).data;
  // Only state and draft reach the tab. A list seed cannot know mergeability, so feeding the
  // full detail would flip an open tab to the conflict glyph the moment its read lands.
  const status =
    detail === null ? (seed ?? null) : { state: detail.state, isDraft: detail.isDraft };
  if (status === null) {
    return <GitPullRequest className="size-3 shrink-0 text-muted-foreground" />;
  }
  const presentation = resolvePullRequestState(status);
  return <presentation.Icon className={cn("size-3 shrink-0", presentation.toneClassName)} />;
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const browserProfiles = useBrowserDefaults().profiles;
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [addSurfaceMenuOpen, setAddSurfaceMenuOpen] = useState(false);
  const [tabScrollState, setTabScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateTabScrollState = useCallback(() => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;

    const hasOverflow = viewport.scrollWidth - viewport.clientWidth > TAB_SCROLL_EDGE_TOLERANCE;
    const canScrollLeft = hasOverflow && viewport.scrollLeft > TAB_SCROLL_EDGE_TOLERANCE;
    const canScrollRight =
      hasOverflow &&
      viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - TAB_SCROLL_EDGE_TOLERANCE;
    setTabScrollState((current) => {
      if (
        current.hasOverflow === hasOverflow &&
        current.canScrollLeft === canScrollLeft &&
        current.canScrollRight === canScrollRight
      ) {
        return current;
      }
      return { hasOverflow, canScrollLeft, canScrollRight };
    });
  }, []);

  const scrollTabs = useCallback((direction: -1 | 1) => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({
      left: direction * Math.max(120, viewport.clientWidth * 0.75),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  const addSurfaceActions = [
    {
      label: "Browser",
      icon: Globe2,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.browser,
      onClick: props.onAddBrowser,
    },
    {
      label: "Terminal",
      icon: TerminalSquare,
      shortcut: "T",
      available: props.terminalAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.terminal,
      onClick: props.onAddTerminal,
    },
    {
      label: "Files",
      icon: Files,
      shortcut: "F",
      available: props.filesAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.files,
      onClick: props.onAddFiles,
    },
    {
      label: "Diff",
      icon: FileDiff,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.diff,
      onClick: props.onAddDiff,
    },
    {
      label: "Pull request",
      icon: GitPullRequest,
      shortcut: "P",
      available: props.pullRequestAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.pullRequest,
      onClick: props.onAddPullRequest,
    },
    {
      label: "Agents",
      icon: Bot,
      shortcut: "A",
      available: props.agentsAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.agents,
      onClick: props.onAddAgents,
    },
  ] as const;

  const handleAddSurfaceMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = surfaceShortcutActionForKey(addSurfaceActions, event.nativeEvent);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    setAddSurfaceMenuOpen(false);
    action.onClick();
  };
  const tabDragRef = useRef<TabDragState | null>(null);
  const suppressedClickSurfaceRef = useRef<string | null>(null);
  const [tabDrag, setTabDrag] = useState<TabDragState | null>(null);
  // C0X patch: shell-pushed module registry for the add-surface menu.
  const shellConfig = useC0xShellConfig();

  const updateTabDrag = useCallback((next: TabDragState | null) => {
    tabDragRef.current = next;
    setTabDrag(next);
  }, []);

  useLayoutEffect(() => {
    const drag = tabDragRef.current;
    if (!drag?.settling || props.surfaces[drag.toIndex]?.id !== drag.surfaceId) return;
    updateTabDrag(null);
  }, [props.surfaces, updateTabDrag]);

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;

      const items: ContextMenuItem<TabContextMenuAction>[] = [];
      if (surface.kind === "file" && surface.attachment === undefined) {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      const menuPreviewTabId = previewTabIdOf(surface, props.previewSessions);
      // Desktop overlay state only arrives once the preview manager has created
      // the tab. A server session id alone can still be ahead of that, and
      // muting then fails with PreviewTabNotFoundError that nobody surfaces.
      const menuOverlay = menuPreviewTabId
        ? (props.desktopByTabId[menuPreviewTabId] ?? null)
        : null;
      const menuMuted = menuOverlay?.audioMuted ?? false;
      if (surface.kind === "preview") {
        // Not gated on audibility: silencing a quiet tab ahead of time is the
        // point, so the item is offered whenever the tab is mutable at all.
        items.push({
          id: "toggle-mute",
          ...tabMuteMenuItem({
            overlay: menuOverlay,
            canResolveRuntimeTabId: props.previewRuntimeTabId !== undefined,
          }),
        });
      }
      if (props.onMoveSurface) {
        items.push(
          {
            id: "move-left",
            label: "Move left",
            disabled: surfaceIndex === 0,
          },
          {
            id: "move-right",
            label: "Move right",
            disabled: surfaceIndex >= props.surfaces.length - 1,
          },
        );
      }
      items.push(
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: props.surfaces.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: props.surfaces.length === 0,
        },
      );

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "copy-path":
          if (surface.kind === "file" && surface.attachment === undefined) {
            props.onCopyFilePath(surface.relativePath);
          }
          break;
        case "toggle-mute": {
          // menuOverlay repeats the disabled gate above: the desktop tab must
          // exist before it can be addressed, however the menu was dismissed.
          const runtimeTabId =
            menuPreviewTabId && menuOverlay
              ? (props.previewRuntimeTabId?.(menuPreviewTabId) ?? null)
              : null;
          if (runtimeTabId) {
            void previewBridge?.setAudioMuted(runtimeTabId, !menuMuted).catch(() => undefined);
          }
          break;
        }
        case "move-left":
          props.onMoveSurface?.(surface, surfaceIndex - 1);
          break;
        case "move-right":
          props.onMoveSurface?.(surface, surfaceIndex + 1);
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  const handleTabPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, surface: RightPanelSurface) => {
      if (!props.onMoveSurface || event.button !== 0 || event.isPrimary === false) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-tab-close]")) return;
      const rects = Array.from(
        event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
          "[data-right-panel-tab-id]",
        ) ?? [],
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.dataset.rightPanelTabId ?? "",
            left: rect.left,
            right: rect.right,
            width: rect.width,
          };
        },
      );
      const fromIndex = rects.findIndex((rect) => rect.id === surface.id);
      if (fromIndex < 0) return;
      updateTabDrag({
        pointerId: event.pointerId,
        surfaceId: surface.id,
        startX: event.clientX,
        startY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        fromIndex,
        toIndex: fromIndex,
        dragging: false,
        settling: false,
        rects,
      });
    },
    [props.onMoveSurface, updateTabDrag],
  );
  const handleTabPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = tabDragRef.current;
      if (!current || current.pointerId !== event.pointerId || current.settling) return;
      const next = updateTabDragPointer(current, event.clientX, event.clientY);
      // Capture only a drag. Capturing on pointer-down retargets an ordinary
      // click to this wrapper, so the nested activation button never gets it.
      if (next.dragging && !event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      updateTabDrag(next);
      if (next.dragging) event.preventDefault();
    },
    [updateTabDrag],
  );
  const handleTabPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, surface: RightPanelSurface) => {
      const current = tabDragRef.current;
      if (!current || current.pointerId !== event.pointerId || current.surfaceId !== surface.id) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const release = resolveTabPointerRelease(current, event.clientX, event.clientY);
      if (release.kind === "activate") {
        updateTabDrag(null);
        return;
      }
      event.preventDefault();
      const { drag: positioned, toIndex } = release;
      suppressedClickSurfaceRef.current = surface.id;
      window.setTimeout(() => {
        if (suppressedClickSurfaceRef.current === surface.id) {
          suppressedClickSurfaceRef.current = null;
        }
      }, 0);
      if (toIndex === current.fromIndex) {
        updateTabDrag(null);
        return;
      }
      updateTabDrag({ ...positioned, toIndex, settling: true });
      props.onMoveSurface?.(surface, toIndex);
    },
    [props, updateTabDrag],
  );
  const handleTabPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (tabDragRef.current?.pointerId !== event.pointerId) return;
      updateTabDrag(null);
    },
    [updateTabDrag],
  );
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, surface: RightPanelSurface) => {
      if (!props.onMoveSurface) return;
      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;
      const toIndex = keyboardTabMoveIndex(
        event.key,
        event.altKey,
        surfaceIndex,
        props.surfaces.length,
      );
      if (toIndex === null) return;
      event.preventDefault();
      event.stopPropagation();
      props.onMoveSurface(surface, toIndex);
    },
    [props],
  );
  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      props.onCloseSurface(surface);
    },
    [props],
  );

  useEffect(() => {
    if (!props.activeSurfaceId || !tabScrollState.hasOverflow) return;
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId, tabScrollState.hasOverflow]);

  useEffect(() => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;

    const content = viewport.firstElementChild;
    const resizeObserver = new ResizeObserver(updateTabScrollState);
    resizeObserver.observe(viewport);
    if (content) resizeObserver.observe(content);
    viewport.addEventListener("scroll", updateTabScrollState, { passive: true });
    updateTabScrollState();

    return () => {
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", updateTabScrollState);
    };
  }, [updateTabScrollState]);

  useEffect(() => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      let delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= viewport.clientWidth;
      if (delta === 0) return;

      const previousScrollLeft = viewport.scrollLeft;
      viewport.scrollLeft += delta;
      if (viewport.scrollLeft === previousScrollLeft) return;
      event.preventDefault();
      updateTabScrollState();
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [updateTabScrollState]);

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
    >
      <div
        className={cn(
          "flex h-[calc(var(--workspace-topbar-height)*1.3)] min-h-[calc(var(--workspace-topbar-height)*1.3)] shrink-0 items-end border-slate-900/10 border-b pb-1 pl-2 dark:border-white/[0.08]",
          // The sheet overlays from the viewport top, so its tab bar keeps
          // the titlebar's height: a compact row re-centers the layout
          // controls a few pixels higher and the cluster jumps on open.
          props.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
          ownsDesktopTitleBar && "drag-region",
          ownsDesktopTitleBar &&
            (props.layoutControls
              ? "wco:pr-[var(--workspace-native-controls-inset)]"
              : "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]"),
          props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
        /* C0X patch: build-capability marker — the shell feature-detects the
           native panel through this attribute and stands its overlays down. */
        data-c0x-native="1"
      >
        <ScrollArea
          ref={tabListRef}
          hideScrollbars
          scrollFade
          className="min-w-0 flex-1 rounded-none"
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-end gap-0.5">
            {props.surfaces.map((surface) => {
              const active = surface.id === props.activeSurfaceId;
              const pending = props.pendingSurfaceIds.has(surface.id);
              const title = surfaceTitle(surface, props.previewSessions, props.terminalLabelsById);
              const previewTabId = previewTabIdOf(surface, props.previewSessions);
              // Desktop state is keyed by the session id, but desktop actions
              // must be addressed with the runtime id.
              const audio = tabAudioState(
                previewTabId ? (props.desktopByTabId[previewTabId] ?? null) : null,
              );
              const audioRuntimeTabId = previewTabId
                ? (props.previewRuntimeTabId?.(previewTabId) ?? null)
                : null;
              const c0xModule =
                surface.kind === "c0x-module"
                  ? (shellConfig.modules.find((module) => module.id === surface.moduleId) ?? null)
                  : null;
              const accent = c0xModule?.accent ?? null;
              const mark = c0xModule?.mark ?? null;
              const accentStyle = accent
                ? ({
                    "--c0x-module-accent": accent,
                    ...(active
                      ? {
                          backgroundColor: `color-mix(in srgb, ${accent} ${resolvedTheme === "dark" ? 10 : 14}%, transparent)`,
                        }
                      : {}),
                  } as CSSProperties)
                : undefined;
              const transformX = tabDragTransform(surface.id, tabDrag);
              const dragged = tabDrag?.surfaceId === surface.id && tabDrag.dragging;
              const tabStyle = {
                ...accentStyle,
                touchAction: props.onMoveSurface ? "none" : undefined,
                ...(tabDrag
                  ? {
                      transform: `translate3d(${transformX}px, 0, 0)`,
                      transitionProperty:
                        dragged && !tabDrag.settling ? "none" : "transform, background-color",
                      transitionDuration: "120ms",
                      transitionTimingFunction: "ease-out",
                      willChange: "transform",
                      zIndex: dragged ? 10 : undefined,
                    }
                  : {}),
              } satisfies CSSProperties;
              return (
                <div
                  key={surface.id}
                  data-active-tab={active}
                  data-right-panel-tab-id={surface.id}
                  data-tab-dragging={dragged || undefined}
                  onPointerDown={(event) => handleTabPointerDown(event, surface)}
                  onPointerMove={handleTabPointerMove}
                  onPointerUp={(event) => handleTabPointerUp(event, surface)}
                  onPointerCancel={handleTabPointerCancel}
                  onMouseDown={handleTabMouseDown}
                  onAuxClick={(event) => handleTabAuxClick(event, surface)}
                  onContextMenu={(event) => void handleTabContextMenu(event, surface)}
                  style={tabStyle}
                  className={cn(
                    "cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                    ownsDesktopTitleBar && "[-webkit-app-region:no-drag]",
                    props.onMoveSurface && "cursor-grab touch-none",
                    dragged && "cursor-grabbing",
                    active
                      ? accent
                        ? "text-foreground dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                        : "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-slate-900/[0.04] hover:text-foreground dark:hover:bg-white/[0.04]",
                  )}
                >
                  <PanelTabCloseButton
                    label={`Close ${title}`}
                    onClick={() => props.onCloseSurface(surface)}
                  >
                    <SurfaceIcon
                      surface={surface}
                      sessions={props.previewSessions}
                      desktopByTabId={props.desktopByTabId}
                      theme={resolvedTheme}
                      environmentId={props.environmentId}
                      pullRequestStatusSeeds={props.pullRequestStatusSeeds}
                    />
                    {pending ? (
                      <span
                        className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
                        aria-hidden
                      />
                    ) : null}
                  </PanelTabCloseButton>
                  {audio === "none" || !audioRuntimeTabId ? null : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="cursor-pointer flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
                            aria-label={audio === "muted" ? `Unmute ${title}` : `Mute ${title}`}
                            onClick={(event) => {
                              // Sibling of the close button, inside a tab that
                              // activates on click: keep this to the toggle.
                              event.stopPropagation();
                              void previewBridge
                                ?.setAudioMuted(audioRuntimeTabId, audio !== "muted")
                                .catch(() => undefined);
                            }}
                          >
                            {audio === "muted" ? (
                              <VolumeOff className="size-3" />
                            ) : (
                              <Volume2 className="size-3" />
                            )}
                          </button>
                        }
                      />
                      <TooltipPopup>{audio === "muted" ? "Unmute tab" : "Mute tab"}</TooltipPopup>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className={cn(
                            "cursor-pointer flex min-w-0 items-center outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                            accent
                              ? "focus-visible:ring-[var(--c0x-module-accent)]"
                              : "focus-visible:ring-ring",
                          )}
                          aria-keyshortcuts={
                            props.onMoveSurface ? "Alt+ArrowLeft Alt+ArrowRight" : undefined
                          }
                          onKeyDown={(event) => handleTabKeyDown(event, surface)}
                          onClick={(event) => {
                            if (suppressedClickSurfaceRef.current === surface.id) {
                              event.preventDefault();
                              suppressedClickSurfaceRef.current = null;
                              return;
                            }
                            props.onActivate(surface);
                          }}
                        >
                          {mark ? (
                            <img
                              src={mark}
                              alt={title}
                              className={cn(
                                "h-3.5 w-auto max-w-full object-contain transition-opacity duration-[120ms] ease-out",
                                active
                                  ? "opacity-100"
                                  : "opacity-[0.7] group-hover/tab:opacity-90 dark:opacity-[0.45] dark:group-hover/tab:opacity-75",
                              )}
                            />
                          ) : (
                            <span className="truncate">{title}</span>
                          )}
                        </button>
                      }
                    />
                    <TooltipPopup>{title}</TooltipPopup>
                  </Tooltip>
                  {active && accent ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
                      style={{ backgroundColor: accent }}
                    />
                  ) : null}
                </div>
              );
            })}
            {props.surfaces.length > 0 ? (
              <Menu open={addSurfaceMenuOpen} onOpenChange={setAddSurfaceMenuOpen}>
                <MenuTrigger
                  render={
                    <Button
                      aria-label="Add panel surface"
                      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                      size="icon-xs"
                      variant="ghost"
                    />
                  }
                >
                  <Plus className="size-3.5" />
                </MenuTrigger>
                <MenuPopup
                  align="start"
                  side="bottom"
                  sideOffset={6}
                  className="min-w-44"
                  onKeyDownCapture={handleAddSurfaceMenuKeyDown}
                >
                  {addSurfaceActions.map((action) => {
                    const Icon = action.icon;
                    // Browser collapses into one row: clicking the trigger opens
                    // the default profile (the common case stays one click),
                    // while hover or arrow reveals the profiles. The choice
                    // lives at open time because a tab's profile is fixed then —
                    // Electron only honours a partition before attach.
                    if (action.label === "Browser" && action.available) {
                      return (
                        <MenuSub key={action.label}>
                          <MenuSubTrigger
                            className="[&>svg:last-child]:ms-0"
                            aria-keyshortcuts={action.shortcut}
                            onClick={(event) => {
                              const pointerType =
                                "pointerType" in event.nativeEvent &&
                                typeof event.nativeEvent.pointerType === "string"
                                  ? event.nativeEvent.pointerType
                                  : undefined;
                              // Touch has no hover path to the profile choices:
                              // its first tap opens the submenu, then a profile
                              // is selected there. Mouse click keeps the common
                              // default-profile action at one click.
                              if (!shouldOpenDefaultBrowserProfileFromMenuClick(pointerType))
                                return;
                              setAddSurfaceMenuOpen(false);
                              action.onClick();
                            }}
                          >
                            <Icon />
                            {action.label}
                            <MenuShortcut>{action.shortcut}</MenuShortcut>
                          </MenuSubTrigger>
                          {/*
                            Capped and truncated: profile names are user-supplied
                            and run to 48 characters, which would otherwise widen
                            the popup to fit-content and wrap.
                          */}
                          <MenuSubPopup className="min-w-40 max-w-56">
                            {browserProfiles.map((profile) => (
                              <MenuItem
                                key={profile.id}
                                onClick={() => props.onAddBrowserInProfile(profile.id)}
                              >
                                <span className="min-w-0 truncate">{profile.name}</span>
                              </MenuItem>
                            ))}
                          </MenuSubPopup>
                        </MenuSub>
                      );
                    }
                    return (
                      <SurfaceMenuItem
                        key={action.label}
                        available={action.available}
                        disabledReason={action.disabledReason}
                        shortcut={action.shortcut}
                        onClick={action.onClick}
                      >
                        <Icon />
                        {action.label}
                      </SurfaceMenuItem>
                    );
                  })}
                  {props.onOpenC0xModule && shellConfig.modules.length > 0 ? <MenuSeparator /> : null}
                  {props.onOpenC0xModule ? shellConfig.modules.map((module) => (
                    <MenuItem key={module.id} disabled={!module.available} onClick={() => props.onOpenC0xModule?.(module.id)}>
                      {module.mark ? <img src={module.mark} alt={module.title} className="h-3.5 w-auto max-w-32 object-contain" /> : module.title}
                    </MenuItem>
                  )) : null}
                </MenuPopup>
              </Menu>
            ) : null}
          </div>
        </ScrollArea>
        {tabScrollState.hasOverflow ? (
          <div
            className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]"
            role="group"
            aria-label="Scroll panel tabs"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label="Scroll tabs left"
                      disabled={!tabScrollState.canScrollLeft}
                      onClick={() => scrollTabs(-1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronLeft />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>Scroll tabs left</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label="Scroll tabs right"
                      disabled={!tabScrollState.canScrollRight}
                      onClick={() => scrollTabs(1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronRight />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>Scroll tabs right</TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
        {props.layoutControls}
        {ownsDesktopTitleBar ? (
          <span
            aria-hidden
            className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.activeSurfaceId === null ? (
          <RightPanelEmptyState
            onAddBrowser={props.onAddBrowser}
            onAddBrowserInProfile={props.onAddBrowserInProfile}
            browserProfiles={browserProfiles}
            onAddTerminal={props.onAddTerminal}
            onAddDiff={props.onAddDiff}
            onAddFiles={props.onAddFiles}
            onAddPullRequest={props.onAddPullRequest}
            onAddAgents={props.onAddAgents}
            onOpenC0xModule={props.onOpenC0xModule ?? null}
            browserAvailable={props.browserAvailable}
            terminalAvailable={props.terminalAvailable}
            diffAvailable={props.diffAvailable}
            filesAvailable={props.filesAvailable}
            pullRequestAvailable={props.pullRequestAvailable}
            agentsAvailable={props.agentsAvailable}
            liveAgentCount={props.liveAgentCount}
          />
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}
