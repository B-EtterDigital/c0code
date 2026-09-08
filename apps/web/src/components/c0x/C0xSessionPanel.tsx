import { useState } from 'react';
import type { ActivePlanState } from '~/session-logic';
import { C0xSessionTasks } from './C0xSessionTasks';
import { C0xSessionDetailsView, C0xSessionSummary, type C0xSessionDetailsViewProps } from './C0xSessionDetails';

export function C0xSessionPanel(props: C0xSessionDetailsViewProps & {
  workspaceRoot?: string | null | undefined;
  branch?: string | null | undefined;
  onOpenGit?: (() => void) | undefined;
  plan?: ActivePlanState | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  return <div className="flex h-full min-h-0 flex-col bg-white text-zinc-900 dark:bg-[#181818] dark:text-zinc-100">
    <C0xSessionTasks plan={props.plan} />
    <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <span className="text-sm font-medium">Session</span>
      {expanded ? <button type="button" className="text-xs text-zinc-600 dark:text-zinc-400" onClick={() => setExpanded(false)}>Overview</button> : null}
    </div>
    {expanded ? <C0xSessionDetailsView {...props} /> : <div className="min-h-0 overflow-y-auto p-4">
      <section className="mb-5 text-xs" aria-label="Environment">
        <div className="mb-2 text-zinc-500 dark:text-zinc-400">Environment</div>
        <div className="break-all">{props.workspaceRoot ?? 'No workspace selected'}</div>
        {props.branch ? <div className="mt-1 text-zinc-600 dark:text-zinc-400">{props.branch}</div> : null}
        {props.onOpenGit ? <button type="button" className="mt-3 rounded-md border border-zinc-200 px-3 py-1.5 dark:border-zinc-700" onClick={props.onOpenGit}>View changes</button> : null}
      </section>
      <C0xSessionSummary {...props} onOpenDetails={() => setExpanded(true)} />
      <button type="button" className="mt-4 text-xs text-zinc-600 dark:text-zinc-400" onClick={() => setExpanded(true)}>Sources, outputs and tool usage</button>
    </div>}
  </div>;
}
