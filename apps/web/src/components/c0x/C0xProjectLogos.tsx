import { useEffect, useRef } from "react";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useProjects, useThreadShells } from "../../state/entities";
import { useTheme } from "../../hooks/useTheme";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { projectActivityIds } from "../../c0x/projectActivity";

function inlineProjectImage(image: HTMLImageElement): string | null {
  if (image.src.startsWith("data:image/")) return image.src;
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  // The runtime cache leaves large source images as signed URLs. Relay a small
  // preview of the already-loaded image so the host never needs those URLs.
  const canvas = document.createElement("canvas");
  canvas.width = 96; canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Project logo preview is unavailable.");
  const scale = Math.min(96 / image.naturalWidth, 96 / image.naturalHeight);
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
  context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height);
  return canvas.toDataURL("image/png");
}

function ProjectLogoReport({ project, projectId, routes }: { project: ProjectFaviconProject; projectId: string; routes: readonly string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { resolvedTheme } = useTheme();
  const signature = JSON.stringify(routes);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let previous = "";
    const report = () => {
      let dataUrl: string | null = null;
      if (project.faviconPath || project.projectIcon) {
        const image = node.querySelector("img");
        const icon = node.querySelector("svg");
        if (project.faviconPath && !image) return;
        if (image) {
          try { dataUrl = inlineProjectImage(image); }
          catch (error) { console.error("[c0x-t3-error] projectLogo.preview", String(error)); return; }
        }
        else if (icon) {
          const copy = icon.cloneNode(true) as SVGElement;
          copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          copy.setAttribute("color", getComputedStyle(icon).color);
          copy.setAttribute("width", "96"); copy.setAttribute("height", "96");
          dataUrl = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
        } else if (project.projectIcon?.kind === "emoji") {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 96 96");
          const text = document.createElementNS(svg.namespaceURI, "text");
          text.setAttribute("x", "48"); text.setAttribute("y", "72"); text.setAttribute("text-anchor", "middle"); text.setAttribute("font-size", "72");
          text.textContent = project.projectIcon.emoji; svg.append(text);
          dataUrl = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        }
        // An image still loading must not replace the saved logo with its fallback glyph.
        if (project.faviconPath && !dataUrl) return;
      }
      const payload = JSON.stringify({ environmentId: project.environmentId, projectId, title: project.title, routes, dataUrl });
      if (payload === previous) return;
      previous = payload;
      console.log("[c0x-project-logo]", payload);
    };
    const observer = new MutationObserver(report);
    observer.observe(node, { subtree: true, childList: true, attributes: true });
    node.addEventListener("load", report, true);
    report();
    return () => { observer.disconnect(); node.removeEventListener("load", report, true); };
  }, [project.environmentId, projectId, project.title, project.faviconPath, project.projectIcon, signature, resolvedTheme]);
  return <span ref={ref} hidden aria-hidden="true"><ProjectFavicon project={project} /></span>;
}

/** The persisted project record supplies both native shell logos and upstream sidebar icons. */
export function C0xProjectLogos() {
  const projects = useProjects();
  const threads = useThreadShells();
  const drafts = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const reportedStatus = useRef(new Map<string, string>());
  useEffect(() => {
    if (!window.c0codeConnectionBridge) return;
    for (const thread of threads) {
      const status = thread.hasPendingApprovals || thread.hasPendingUserInput ? "needs-input"
        : thread.session?.status === "running" || thread.session?.status === "starting" || thread.latestTurn?.state === "running" || thread.backgroundLiveness === "working" ? "running"
        : thread.session?.status === "ready" ? "ready" : "idle";
      for (const threadId of projectActivityIds(thread, drafts)) {
        const report = JSON.stringify({ threadId, status, updatedAt: thread.updatedAt });
        if (reportedStatus.current.get(threadId) === report) continue;
        reportedStatus.current.set(threadId, report);
        console.log("[c0x-thread-status]", report);
      }
    }
  }, [threads, drafts]);
  if (!window.c0codeConnectionBridge) return null;
  return <>{projects.map((project) => <ProjectLogoReport key={`${project.environmentId}:${project.id}`} project={project} projectId={project.id} routes={[
    ...threads.filter((thread) => thread.environmentId === project.environmentId && thread.projectId === project.id).map((thread) => `/${thread.environmentId}/${thread.id}`),
    ...Object.entries(drafts).filter(([, draft]) => draft.environmentId === project.environmentId && draft.projectId === project.id).map(([id]) => `/draft/${id}`),
  ]} />)}</>;
}
