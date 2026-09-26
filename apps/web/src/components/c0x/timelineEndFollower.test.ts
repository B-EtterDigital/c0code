import { describe, expect, it } from "vite-plus/test";
import { createTimelineEndFollower } from "./timelineEndFollower";

function fixture() {
  const state = { height: 10000, viewport: 600, offset: 0 };
  const frames = new Map<number, () => void>();
  let next = 0,
    jumps = 0;
  const follower = createTimelineEndFollower({
    read: () => state,
    jump: () => {
      jumps++;
      state.offset = state.height - state.viewport;
    },
    request: (callback) => {
      frames.set(++next, callback);
      return next;
    },
    cancel: (id) => {
      frames.delete(id);
    },
  });
  const frame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  return { follower, state, frames, frame, jumps: () => jumps };
}

describe("one-click end intent", () => {
  it("settles repeated virtual row measurements without another click", () => {
    const f = fixture();
    f.follower.start();
    for (let n = 0; n < 15; n++) {
      f.state.height += 2500;
      f.frame();
    }
    expect(f.state.offset).toBe(f.state.height - f.state.viewport);
    for (let n = 0; n < 10; n++) f.frame();
    expect(f.frames.size).toBe(0);
    const jumps = f.jumps();
    f.state.height += 7000;
    f.follower.changed();
    f.frame();
    expect(f.state.offset).toBe(f.state.height - f.state.viewport);
    expect(f.jumps()).toBeGreaterThan(jumps);
  });
  it("yields immediately to manual navigation or a different conversation", () => {
    const f = fixture();
    f.follower.start();
    f.frame();
    f.follower.stop();
    f.state.offset = 123;
    f.state.height += 20000;
    f.follower.changed();
    f.frame();
    expect(f.state.offset).toBe(123);
    expect(f.frames.size).toBe(0);
  });
  it("coalesces resize notifications and bounds work even when scrolling fails", () => {
    const f = fixture();
    f.follower.start();
    for (let n = 0; n < 100; n++) f.follower.changed();
    expect(f.frames.size).toBe(1);
    for (let n = 0; n < 130; n++) {
      f.state.offset = 0;
      f.frame();
    }
    expect(f.frames.size).toBe(0);
    expect(f.jumps()).toBeLessThanOrEqual(120);
  });
});
