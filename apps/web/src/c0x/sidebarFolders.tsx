import { useSyncExternalStore } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { ProjectFavicon } from "../components/ProjectFavicon";
import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import { emitC0xSidebarEvent, useC0xSidebar } from "./sidebar";

const KEY = "c0x.sidebar.collapsedFolders.v1";
let collapsed: Readonly<Record<string, boolean>> | undefined;
const listeners = new Set<() => void>();
function read() {
  if (!window.__c0xSidebar) return EMPTY;
  if (collapsed) return collapsed;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    collapsed =
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([, flag]) => flag === true))
        : {};
  } catch (error) {
    emitC0xSidebarEvent({ type: "error", operation: "read-folders", message: String(error) });
    collapsed = {};
  }
  return collapsed;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const changed = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    collapsed = undefined;
    listener();
  };
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", changed);
  };
}
function toggle(key: string) {
  collapsed = { ...read(), [key]: !read()[key] };
  try {
    localStorage.setItem(KEY, JSON.stringify(collapsed));
  } catch (error) {
    emitC0xSidebarEvent({ type: "error", operation: "save-folders", message: String(error) });
  }
  listeners.forEach((listener) => listener());
}
const EMPTY: Readonly<Record<string, boolean>> = {};
export const useC0xCollapsedFolders = () => useSyncExternalStore(subscribe, read, () => EMPTY);

export function C0xSidebarFolder({
  project,
  count,
  isCollapsed,
}: {
  project: SidebarProjectSnapshot;
  count: number;
  isCollapsed: boolean;
}) {
  const { folderSizes } = useC0xSidebar();
  const identity = `${project.environmentId}:${project.id}`;
  const size = Math.max(16, Math.min(64, folderSizes[identity] ?? 20));
  return (
    <li className="list-none">
      <button
        type="button"
        aria-expanded={!isCollapsed}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => toggle(project.projectKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          emitC0xSidebarEvent({
            type: "folder-menu",
            projectId: project.id,
            environmentId: project.environmentId,
            title: project.displayName,
          });
        }}
      >
        {isCollapsed ? (
          <ChevronRightIcon className="size-3 shrink-0" />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0" />
        )}
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: size, height: size }}
        >
          <ProjectFavicon project={project} className="size-full" />
        </span>
        <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
        <span className="tabular-nums">{count}</span>
      </button>
    </li>
  );
}

export { groupC0xSidebarRows, groupC0xSidebarSections } from "./sidebarFolders.logic";
