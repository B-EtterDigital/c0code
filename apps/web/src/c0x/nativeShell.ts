/**
 * C0X native-shell seam (C0VIBE patch, not upstream).
 *
 * The C0VIBE desktop shell embeds this web app as the `t3-original` coding
 * core and injects a config object at `window.__c0xShell` (before load and on
 * every change, re-announced through the `c0x-shell-config` window event).
 * When the config is absent — a stock browser, upstream dev — every consumer
 * renders exactly upstream behavior: empty module list, no SMARCH section.
 *
 * Guest → shell events ride the shell's EXISTING right-panel report channel:
 * each event is queued on `window.__c0xShellEvents` and the shell's reporter
 * script (injected into the webview) drains the queue into its next report —
 * `__c0xT3RightPanelForceReport` makes that report immediate. Standalone (no
 * shell) the queue is bounded and simply never drained. Shell → guest state
 * rides config re-injection.
 */
import { useSyncExternalStore } from "react";

export const C0X_SHELL_CONFIG_EVENT = "c0x-shell-config";

declare global {
  interface Window {
    /** Present in C0X-patched builds — the shell feature-detects native support. */
    __c0xNativeBuild?: boolean;
    /** Shell-injected panel config; absent in standalone browsers. */
    __c0xShell?: unknown;
    /** Guest → shell event queue, drained by the shell's reporter script. */
    __c0xShellEvents?: unknown[];
    /** Installed by the shell's reporter script; forces an immediate report. */
    __c0xT3RightPanelForceReport?: () => void;
    /** Registered by the chat view: the shell opens a module tab through it. */
    __c0xShellOpenModule?: (moduleId: string) => void;
  }
}

if (typeof window !== "undefined") {
  window.__c0xNativeBuild = true;
}

export interface C0xModuleDescriptor {
  /** Stable module id — the shell's dock tab id (e.g. "transcription"). */
  id: string;
  /** Display name (e.g. "C0DIC"). */
  title: string;
  /** One-line launcher-card description. */
  blurb: string;
  /** Lucide icon name understood by the module icon map; fallback glyph otherwise. */
  icon?: string;
  /** Compact C0VIBE wordmark transported by the shell as a WebP data URI. */
  mark: string | null;
  /** Shell-owned module accent; the guest never owns module colour choices. */
  accent: string | null;
  /** Whether this account may open the module. Missing transport fails closed. */
  available: boolean;
  /** Shell-owned explanation shown by the launcher's existing unavailable tile. */
  disabledReason: string;
}

export interface C0xSmarchToggle {
  key: string;
  title: string;
  blurb: string;
  enabled: boolean;
}

export interface C0xSmarchConfig {
  /** Section heading, shell-owned so wording changes never need a rebuild. */
  title: string;
  toggles: C0xSmarchToggle[];
}

export interface C0xShellConfig {
  modules: C0xModuleDescriptor[];
  smarch: C0xSmarchConfig | null;
}

const EMPTY_CONFIG: C0xShellConfig = { modules: [], smarch: null };

function sanitizeModules(raw: unknown): C0xModuleDescriptor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Partial<C0xModuleDescriptor>;
    if (typeof record.id !== "string" || record.id.length === 0) return [];
    if (typeof record.title !== "string" || record.title.length === 0) return [];
    return [
      {
        id: record.id,
        title: record.title,
        blurb: typeof record.blurb === "string" ? record.blurb : "",
        ...(typeof record.icon === "string" ? { icon: record.icon } : {}),
        mark:
          typeof record.mark === "string" && record.mark.startsWith("data:image/webp;base64,")
            ? record.mark
            : null,
        accent:
          typeof record.accent === "string" && /^#[0-9a-f]{6}$/i.test(record.accent)
            ? record.accent
            : null,
        available: record.available === true,
        disabledReason:
          typeof record.disabledReason === "string" && record.disabledReason
            ? record.disabledReason
            : typeof (record as { unavailableReason?: unknown }).unavailableReason === "string"
              ? ((record as { unavailableReason?: string }).unavailableReason as string)
              : "",
      },
    ];
  });
}

function sanitizeSmarch(raw: unknown): C0xSmarchConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<C0xSmarchConfig>;
  if (!Array.isArray(record.toggles)) return null;
  const toggles = record.toggles.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const toggle = entry as Partial<C0xSmarchToggle>;
    if (typeof toggle.key !== "string" || typeof toggle.title !== "string") return [];
    return [
      {
        key: toggle.key,
        title: toggle.title,
        blurb: typeof toggle.blurb === "string" ? toggle.blurb : "",
        enabled: toggle.enabled === true,
      },
    ];
  });
  return {
    title: typeof record.title === "string" && record.title.length > 0 ? record.title : "SMARCH",
    toggles,
  };
}

let cachedSource: unknown = null;
let cachedConfig: C0xShellConfig = EMPTY_CONFIG;

function readConfig(): C0xShellConfig {
  const source =
    typeof window === "undefined"
      ? null
      : ((window as { __c0xShell?: unknown }).__c0xShell ?? null);
  if (source === cachedSource) return cachedConfig;
  cachedSource = source;
  if (!source || typeof source !== "object") {
    cachedConfig = EMPTY_CONFIG;
    return cachedConfig;
  }
  const record = source as { modules?: unknown; smarch?: unknown };
  cachedConfig = {
    modules: sanitizeModules(record.modules),
    smarch: sanitizeSmarch(record.smarch),
  };
  return cachedConfig;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(C0X_SHELL_CONFIG_EVENT, onChange);
  return () => window.removeEventListener(C0X_SHELL_CONFIG_EVENT, onChange);
}

export function getC0xShellConfig(): C0xShellConfig {
  return readConfig();
}

export function useC0xShellConfig(): C0xShellConfig {
  return useSyncExternalStore(subscribe, readConfig, () => EMPTY_CONFIG);
}

export function c0xModuleById(moduleId: string): C0xModuleDescriptor | null {
  return readConfig().modules.find((module) => module.id === moduleId) ?? null;
}

export type C0xShellEvent =
  | { type: "smarch-set"; key: string; enabled: boolean }
  | { type: "smarch-announce" }
  | { type: "module-opened"; moduleId: string }
  | { type: "module-closed"; moduleId: string }
  | { type: "fluid-queue-error"; operation: string; message: string };

/**
 * Registers the shell→guest module opener (the chat view owns the thread ref
 * the surface needs). Returns the unregister cleanup; a newer registration
 * wins and an unregister never removes someone else's.
 */
export function registerC0xModuleOpener(open: (moduleId: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.__c0xShellOpenModule = open;
  return () => {
    if (window.__c0xShellOpenModule === open) delete window.__c0xShellOpenModule;
  };
}

/**
 * Queues one event for the shell and asks for an immediate report. Bounded so
 * a standalone browser (nothing ever drains) cannot grow the queue unbounded.
 */
export function postC0xShellEvent(event: C0xShellEvent): void {
  if (typeof window === "undefined") return;
  const queue = (window.__c0xShellEvents ??= []);
  queue.push(event);
  if (queue.length > 40) queue.splice(0, queue.length - 40);
  window.__c0xT3RightPanelForceReport?.();
}
