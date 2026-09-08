import { CheckIcon, CircleIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import type { ActivePlanState } from "~/session-logic";

export function C0xSessionTasks({ plan }: { plan: ActivePlanState | null | undefined }) {
  const [limit, setLimit] = useState(10);
  const steps = plan?.steps ?? [];
  const remaining = steps.filter((step) => step.status !== "completed");
  const completed = steps.length - remaining.length;
  return (
    <section aria-label="Tasks" className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">Tasks</span>
        {steps.length > 0 ? <span className="text-zinc-500 dark:text-zinc-400">{completed}/{steps.length} done</span> : null}
      </div>
      {remaining.length > 0 ? (
        <ol className="space-y-2 text-xs">
          {remaining.slice(0, limit).map((task, index) => (
            <li key={`${index}:${task.step}`} className="flex items-start gap-2" data-task-status={task.status}>
              {task.status === "inProgress" ? <LoaderCircleIcon aria-label="In progress" className="mt-0.5 size-3 shrink-0 text-blue-600 dark:text-blue-400" /> : <CircleIcon aria-label="Pending" className="mt-0.5 size-3 shrink-0 text-zinc-500 dark:text-zinc-400" />}
              <span className="min-w-0 break-words">{task.step}</span>
            </li>
          ))}
        </ol>
      ) : <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {steps.length > 0 ? <><CheckIcon className="size-3" />All reported tasks complete.</> : "The agent has not shared a task list yet."}
      </p>}
      {remaining.length > 10 ? <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">Showing {Math.min(limit, remaining.length)} of {remaining.length}</span>
        {limit < 50 && limit < remaining.length ? <button type="button" className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700" onClick={() => setLimit((value) => Math.min(50, value + 10))}>Show {Math.min(10, remaining.length - limit)} more</button> : null}
        {limit > 10 ? <button type="button" className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700" onClick={() => setLimit(10)}>Show 10</button> : null}
      </div> : null}
    </section>
  );
}
