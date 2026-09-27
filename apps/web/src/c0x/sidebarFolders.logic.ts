/** Stable grouping retains the server's manual order within each project. */
export function groupC0xSidebarRows<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  projectOrder: readonly string[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...new Set([...projectOrder, ...groups.keys()])].flatMap((key) => groups.get(key) ?? []);
}

/** Keep native pinned/active/snoozed/settled boundaries and their drop targets intact. */
export function groupC0xSidebarSections<T extends { kind: string }>(
  items: readonly T[],
  keyOf: (row: T) => string,
  projectOrder: readonly string[],
): T[] {
  const result: T[] = [];
  let rows: T[] = [];
  const flush = () => {
    result.push(...groupC0xSidebarRows(rows, keyOf, projectOrder));
    rows = [];
  };
  for (const item of items) {
    if (item.kind === "thread") rows.push(item);
    else {
      flush();
      result.push(item);
    }
  }
  flush();
  return result;
}
