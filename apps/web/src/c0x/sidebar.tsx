import { useEffect, useSyncExternalStore } from "react";

export interface C0xSidebarState {
  splitCounts: Readonly<Record<string, number>>;
  folderSizes: Readonly<Record<string, number>>;
}

declare global {
  interface Window {
    __c0xSidebar?: C0xSidebarState;
  }
}

let previewOpen = false;
let returningFocus = false;
function closePreview() {
  if (!previewOpen) return;
  previewOpen = false;
  emitC0xSidebarEvent({ type: "split-preview-leave" });
}

export function C0xSidebarLifecycle() {
  useEffect(() => {
    const returnFocus = (event: Event) => {
      const threadId = (event as CustomEvent<unknown>).detail;
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>("[data-c0x-split-count]"),
      ].find((item) => item.dataset.c0xSplitCount === threadId);
      returningFocus = true;
      button?.focus({ preventScroll: true });
      returningFocus = false;
    };
    window.addEventListener("scroll", closePreview, true);
    window.addEventListener("resize", closePreview);
    window.addEventListener("c0x-sidebar-return-focus", returnFocus);
    return () => {
      window.removeEventListener("scroll", closePreview, true);
      window.removeEventListener("resize", closePreview);
      window.removeEventListener("c0x-sidebar-return-focus", returnFocus);
    };
  }, []);
  return null;
}

const EMPTY: C0xSidebarState = { splitCounts: {}, folderSizes: {} };
const EVENT = "c0x-sidebar-config";
const subscribe = (listener: () => void) => {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
const snapshot = () => window.__c0xSidebar ?? EMPTY;

export function useC0xSidebar() {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function emitC0xSidebarEvent(event: Record<string, unknown>) {
  if (!window.__c0xSidebar) return false;
  console.log("[c0x-sidebar] " + JSON.stringify(event));
  return true;
}

/** The shell opens this palette in the active coding pane, outside the narrow rail. */
export function openC0xProjectPicker() {
  return emitC0xSidebarEvent({ type: "project-picker" });
}

export function C0xSidebarSplitCount({ threadId, title }: { threadId: string; title: string }) {
  const { splitCounts } = useC0xSidebar();
  const count = splitCounts[threadId] ?? 0;
  if (count < 2) return null;
  const open = (element: HTMLButtonElement, focus = false) => {
    if (returningFocus) return;
    previewOpen = true;
    const rect = element.getBoundingClientRect();
    emitC0xSidebarEvent({
      type: "split-preview",
      threadId,
      title,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
      focus,
    });
  };
  const close = closePreview;
  return (
    <button
      type="button"
      aria-label={`${count} splits in ${title}`}
      aria-haspopup="menu"
      data-c0x-split-count={threadId}
      className="shrink-0 rounded px-1.5 text-xs tabular-nums text-sidebar-muted-foreground hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onMouseEnter={(event) => open(event.currentTarget)}
      onMouseLeave={close}
      onFocus={(event) => open(event.currentTarget)}
      onBlur={close}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        open(event.currentTarget, true);
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open(event.currentTarget, event.detail === 0);
      }}
    >
      {count}
    </button>
  );
}
