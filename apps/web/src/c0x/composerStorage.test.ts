import { describe, expect, it } from "vite-plus/test";
import { createMemoryStorage } from "../lib/storage";
import { createComposerStorage, mergeComposerSnapshots } from "./composerStorage";

const key = "drafts";
const snapshot = (drafts: Record<string, unknown>) => JSON.stringify({ state: { drafts }, version: 9 });

describe("composer persistence shared by multiple panes", () => {
  it("retains another pane's draft when a stale pane flushes at unload", () => {
    const disk = createMemoryStorage();
    const initial = snapshot({ a: { prompt: "", attachments: [] } });
    disk.setItem(key, initial);
    const visible = createComposerStorage(disk);
    const sidebar = createComposerStorage(disk);
    visible.getItem(key);
    sidebar.getItem(key);
    const filled = snapshot({ a: { prompt: "unsent", attachments: [{ id: "image" }] } });
    visible.setItem(key, filled);
    sidebar.setItem(key, snapshot({ a: { prompt: "", attachments: [], mode: "full" } }));
    expect(JSON.parse(disk.getItem(key) as string).state.drafts.a).toEqual({
      prompt: "unsent", attachments: [{ id: "image" }], mode: "full",
    });
    // Repeated writes must not delete remote fields absent from local memory.
    visible.setItem(key, filled);
    expect(JSON.parse(disk.getItem(key) as string).state.drafts.a.mode).toBe("full");
  });

  it("preserves edits to different drafts and applies observed deletion", () => {
    expect(mergeComposerSnapshots(
      { a: "old", b: "old" }, { a: "mine", b: "old" }, { a: "old", b: "theirs" },
    )).toEqual({ a: "mine", b: "theirs" });
    expect(mergeComposerSnapshots({ a: "old" }, {}, { a: "old" })).toEqual({});
    expect(mergeComposerSnapshots({ a: "old" }, {}, { a: "new" })).toEqual({ a: "new" });
  });

  it("merges incoming changes with unflushed typing and subsequently persists both", () => {
    const disk = createMemoryStorage();
    disk.setItem(key, snapshot({ a: "old", b: "old" }));
    const pane = createComposerStorage(disk);
    pane.getItem(key);
    const remote = snapshot({ a: "old", b: "remote" });
    disk.setItem(key, remote);
    const merged = pane.receive(JSON.parse(snapshot({ a: "typing", b: "old" })), remote);
    pane.setItem(key, JSON.stringify(merged));
    expect(JSON.parse(disk.getItem(key) as string).state.drafts).toEqual({ a: "typing", b: "remote" });
  });

  it("fails loudly without replacing corrupt saved data", () => {
    const disk = createMemoryStorage();
    const pane = createComposerStorage(disk);
    pane.getItem(key);
    disk.setItem(key, "broken-json");
    expect(() => pane.setItem(key, snapshot({ a: "new" }))).toThrow();
    expect(disk.getItem(key)).toBe("broken-json");
  });
});
