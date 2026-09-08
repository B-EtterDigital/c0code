import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { TurnId } from "@t3tools/contracts";
import type { ActivePlanState } from "~/session-logic";
import { C0xSessionTasks } from "./C0xSessionTasks";

let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { await act(() => renderer?.unmount()); vi.unstubAllGlobals(); });

it("shows upcoming actions, expands to 50, and updates from agent events", async () => {
  const plan: ActivePlanState = { createdAt: "2026-09-09T00:00:00Z", turnId: TurnId.make("turn"),
    steps: [{ step: "Already done", status: "completed" }, ...Array.from({ length: 55 }, (_, index) => ({ step: `Task ${index + 1}`, status: index === 0 ? "inProgress" as const : "pending" as const }))] };
  await act(() => { renderer = create(<C0xSessionTasks plan={plan} />); });
  expect(renderer.root.findAllByType("li")).toHaveLength(10);
  expect(renderer.root.findAllByType("li")[0]?.props["data-task-status"]).toBe("inProgress");
  for (let i = 0; i < 4; i++) {
    const more = renderer.root.findAllByType("button").find((button) => button.children.join("").includes("more"));
    await act(() => more?.props.onClick());
  }
  expect(renderer.root.findAllByType("li")).toHaveLength(50);
  expect(renderer.root.findAllByType("button").some((button) => button.children.join("").includes("more"))).toBe(false);
  await act(() => renderer.update(<C0xSessionTasks plan={{ ...plan, steps: plan.steps.map((step) => ({ ...step, status: "completed" })) }} />));
  expect(renderer.root.findAllByType("li")).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("All reported tasks complete");
});

it("does not invent tasks when the agent has not published a plan", async () => {
  await act(() => { renderer = create(<C0xSessionTasks plan={null} />); });
  expect(renderer.root.findAllByType("li")).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("has not shared a task list");
});
