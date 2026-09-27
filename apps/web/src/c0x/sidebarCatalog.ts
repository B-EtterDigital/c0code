import { useEffect, useMemo } from "react";
import type { Project, SidebarThreadSummary } from "../types";

type CatalogThread = Pick<
  SidebarThreadSummary,
  | "id"
  | "environmentId"
  | "projectId"
  | "title"
  | "branch"
  | "updatedAt"
  | "session"
  | "archivedAt"
  | "latestUserMessageAt"
>;
type CatalogProject = Pick<Project, "id" | "environmentId" | "title" | "workspaceRoot">;

/** Includes remote computers and filtered/collapsed rows, but never unsent drafts. */
export function projectC0xSidebarCatalog(
  threads: readonly CatalogThread[],
  projects: readonly CatalogProject[],
) {
  const byProject = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project]),
  );
  return threads
    .filter((thread) => thread.archivedAt === null && thread.latestUserMessageAt !== null)
    .map((thread) => {
      const project = byProject.get(`${thread.environmentId}:${thread.projectId}`);
      return {
        id: thread.id,
        href: `/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.id)}`,
        title: thread.title,
        group: project?.title ?? null,
        kind: "thread" as const,
        environmentId: thread.environmentId,
        projectName: project?.title ?? null,
        branch: thread.branch,
        updatedAt: thread.session?.updatedAt ?? thread.updatedAt,
        status: thread.session?.status ?? null,
      };
    });
}

export function useC0xSidebarCatalog(
  threads: readonly SidebarThreadSummary[],
  projects: readonly Project[],
) {
  const serialized = useMemo(
    () => JSON.stringify(projectC0xSidebarCatalog(threads, projects)),
    [threads, projects],
  );
  useEffect(() => {
    const publish = () => {
      if (window.__c0xSidebar) console.log("[c0x-t3-catalog] sessions " + serialized);
    };
    publish();
    window.addEventListener("c0x-sidebar-config", publish);
    window.addEventListener("c0x-sidebar-catalog-request", publish);
    return () => {
      window.removeEventListener("c0x-sidebar-config", publish);
      window.removeEventListener("c0x-sidebar-catalog-request", publish);
    };
  }, [serialized]);
}
