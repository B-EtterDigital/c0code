/**
 * C0X patch: the body of a `c0x-module` surface. Renders only a measurable
 * host node — the embedding C0VIBE shell reads `data-c0x-module-surface`
 * through its geometry reporter and projects the real module UI (dictation
 * sessions, chats, captures, …) onto this rect. The muted hint below is what
 * a standalone browser sees; under the shell the projection covers it.
 */
import { useEffect } from "react";

import { c0xModuleById, postC0xShellEvent } from "~/c0x/nativeShell";

export function C0xModuleSurface({ moduleId }: { moduleId: string }) {
  const module = c0xModuleById(moduleId);

  useEffect(() => {
    postC0xShellEvent({ type: "module-opened", moduleId });
    return () => postC0xShellEvent({ type: "module-closed", moduleId });
  }, [moduleId]);

  return (
    <div
      data-c0x-module-surface={moduleId}
      className="flex min-h-0 flex-1 items-center justify-center"
    >
      <p className="max-w-64 px-6 text-center text-muted-foreground text-xs leading-relaxed">
        {module ? `${module.title} renders here inside C0VIBE.` : "This surface renders inside C0VIBE."}
      </p>
    </div>
  );
}
