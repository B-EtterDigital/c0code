import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  registerC0xPairingState,
  runC0xPairingExchange,
  type C0xPairingState,
} from "./pairingState";

afterEach(() => vi.unstubAllGlobals());

describe("native pairing lifecycle", () => {
  it("keeps recovery disabled through the exchange and the navigation after success", async () => {
    const state: C0xPairingState = { version: 1, phase: "idle" };
    let complete!: (value: string | null) => void;
    const response = new Promise<string | null>((resolve) => {
      complete = resolve;
    });
    const pending = runC0xPairingExchange(state, () => response);
    expect(state.phase).toBe("submitting");
    await Promise.resolve();
    expect(state.phase).toBe("submitting");
    complete(null);
    await expect(pending).resolves.toBeNull();
    expect(state.phase).toBe("authenticated");
  });

  it("allows recovery after an unsuccessful exchange and propagates unexpected errors", async () => {
    const state: C0xPairingState = { version: 1, phase: "idle" };
    await expect(runC0xPairingExchange(state, async () => "Expired token")).resolves.toBe(
      "Expired token",
    );
    expect(state.phase).toBe("idle");
    await expect(
      runC0xPairingExchange(state, async () => {
        throw new Error("Disconnected");
      }),
    ).rejects.toThrow("Disconnected");
    expect(state.phase).toBe("idle");
  });

  it("removes stale state on unmount without clearing a newer pairing surface", () => {
    vi.stubGlobal("window", {});
    const oldCleanup = registerC0xPairingState({ version: 1, phase: "submitting" });
    const current: C0xPairingState = { version: 1, phase: "idle" };
    const cleanup = registerC0xPairingState(current);
    oldCleanup();
    expect(window.__c0xPairingState).toBe(current);
    cleanup();
    expect(window.__c0xPairingState).toBeUndefined();
  });
});
