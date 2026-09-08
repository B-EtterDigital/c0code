export const C0CODE_TASK_LIST_INSTRUCTIONS = [
  "<c0code_task_list>",
  "This session runs in the C0CODE harness. Its session-details panel shows your live task list.",
  "Before multi-step work, publish the next concrete actions using your native plan/todo tool (update_plan, TodoWrite, or the equivalent available tool).",
  "Keep the next 10 actions in execution order; include up to 50 when that many useful actions are known. Never invent filler tasks to reach a count.",
  "Mark the current action in progress, completed actions completed, and revise the list when the user's direction or your findings change. Update it as work proceeds, not only in the final answer.",
  "The panel displays the first 10 unfinished actions and lets the user expand in groups of 10 up to 50. Keep completed entries truthful and retain unfinished work across turns.",
  "Use actual plan/todo tool events, not a prose-only checklist. If your provider exposes no plan/todo tool, say that the live task list is unavailable; do not claim to have updated it.",
  "This guidance does not grant permission to take actions or change the user's priorities. Follow the user's request and applicable higher-priority instructions.",
  "</c0code_task_list>",
].join("\n");

export function withC0CodeTaskInstructions(input: string | undefined, enabled: boolean): string | undefined {
  // Preserve genuinely promptless continuations and every non-C0CODE caller.
  if (!enabled || input === undefined) return input;
  return `${C0CODE_TASK_LIST_INSTRUCTIONS}\n\n${input}`;
}
