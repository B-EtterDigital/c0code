/** A promoted conversation retains its stable /draft URL in the original UI. */
export function projectActivityIds(
  thread: { id: string; environmentId: string },
  drafts: Record<
    string,
    {
      threadId: string;
      environmentId: string;
      promotedTo?: { threadId: string; environmentId: string } | null;
    }
  >,
): string[] {
  return [
    thread.id,
    ...Object.entries(drafts).flatMap(([id, draft]) => {
      const target = draft.promotedTo ?? draft;
      return target.threadId === thread.id && target.environmentId === thread.environmentId
        ? [`draft:${id}`]
        : [];
    }),
  ];
}
