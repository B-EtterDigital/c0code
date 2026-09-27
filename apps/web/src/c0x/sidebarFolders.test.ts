import { describe, expect, it } from "vite-plus/test";
import { groupC0xSidebarRows, groupC0xSidebarSections } from "./sidebarFolders.logic";

describe("C0CODE folders over native sidebar order", () => {
  it("keeps manual order within each folder and separates the same project id on different computers", () => {
    const rows = [
      { id: "b2", project: "remote:project" },
      { id: "a3", project: "local:project" },
      { id: "b1", project: "remote:project" },
      { id: "a1", project: "local:project" },
    ];
    const ordered = groupC0xSidebarRows(rows, (row) => row.project, [
      "local:project",
      "remote:project",
    ]);
    expect(ordered.map((row) => row.id)).toEqual(["a3", "a1", "b2", "b1"]);
    expect(rows.map((row) => row.id)).toEqual(["b2", "a3", "b1", "a1"]);
  });

  it("preserves the native section boundaries used by settle, snooze and drag targets", () => {
    const pinned = { kind: "marker", id: "pinned" };
    const active = { kind: "marker", id: "active" };
    const settled = { kind: "marker", id: "settled" };
    const rows = [
      pinned,
      { kind: "thread", id: "b-pinned", project: "b" },
      { kind: "thread", id: "a-pinned", project: "a" },
      active,
      { kind: "thread", id: "b-active", project: "b" },
      { kind: "thread", id: "a-active", project: "a" },
      settled,
    ];
    const result = groupC0xSidebarSections(
      rows,
      (row) => ("project" in row ? (row.project ?? "") : ""),
      ["a", "b"],
    );
    expect(result.map((row) => row.id)).toEqual([
      "pinned",
      "a-pinned",
      "b-pinned",
      "active",
      "a-active",
      "b-active",
      "settled",
    ]);
    expect(result[0]).toBe(pinned);
    expect(result[3]).toBe(active);
    expect(result[6]).toBe(settled);
  });

  it("retains a newly connected project missing from the saved project order", () => {
    expect(
      groupC0xSidebarRows([{ project: "new" }, { project: "saved" }], (row) => row.project, [
        "saved",
        "removed",
      ]),
    ).toEqual([{ project: "saved" }, { project: "new" }]);
  });
});
