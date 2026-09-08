import { expect, it } from "vite-plus/test";
import { C0CODE_TASK_LIST_INSTRUCTIONS, withC0CodeTaskInstructions } from "./c0xTaskInstructions.ts";

it("adds the native task-tool contract to C0CODE turns without replacing the user's request", () => {
  const request = "Fix the bug, then document it.";
  expect(withC0CodeTaskInstructions(request, true)).toBe(`${C0CODE_TASK_LIST_INSTRUCTIONS}\n\n${request}`);
  expect(C0CODE_TASK_LIST_INSTRUCTIONS).toContain("update_plan, TodoWrite");
  expect(C0CODE_TASK_LIST_INSTRUCTIONS).toContain("up to 50");
});
it("preserves other harnesses and promptless continuation semantics", () => {
  expect(withC0CodeTaskInstructions("hello", false)).toBe("hello");
  expect(withC0CodeTaskInstructions(undefined, true)).toBeUndefined();
});
