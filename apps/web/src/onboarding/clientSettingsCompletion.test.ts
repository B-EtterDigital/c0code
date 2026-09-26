import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CLIENT_SETTINGS_STORAGE_KEY } from "../clientPersistenceStorage";
import {
  persistClientSettingsWithCompletion,
  subscribeSharedOnboardingCompletion,
} from "./clientSettingsCompletion";

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../clientPersistenceStorage", () => ({
  CLIENT_SETTINGS_STORAGE_KEY: "t3code:client-settings:v1",
  readBrowserClientSettings: mocks.read,
}));
vi.mock("../localApi", () => ({
  ensureLocalApi: () => ({ persistence: { setClientSettings: mocks.write } }),
}));

let target: EventTarget;
let unsubscribe: (() => void) | undefined;
const completed: ClientSettings = {
  ...DEFAULT_CLIENT_SETTINGS,
  onboardingCompletedAt: "2026-09-26T13:00:00Z",
};
function notify(key = CLIENT_SETTINGS_STORAGE_KEY) {
  const event = new Event("storage");
  Object.defineProperty(event, "key", { value: key });
  target.dispatchEvent(event);
}
beforeEach(() => {
  target = new EventTarget();
  vi.stubGlobal("window", target);
  mocks.read.mockReset().mockReturnValue(DEFAULT_CLIENT_SETTINGS);
  mocks.write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  unsubscribe?.();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("setup completion across panes", () => {
  it("reports unavailable storage without preventing hydration recovery", () => {
    const error = new Error("storage unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.read.mockImplementationOnce(() => {
      throw error;
    });
    const dismiss = vi.fn();
    unsubscribe = subscribeSharedOnboardingCompletion(dismiss);
    expect(report).toHaveBeenCalledWith(
      "[c0x-t3-error] onboarding.sharedCompletion.read",
      String(error),
    );
    mocks.read.mockReturnValue(completed);
    notify();
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(completed);
  });
  it("notifies an open wizard once when a sibling finishes, and tears down its listener", () => {
    const dismiss = vi.fn();
    unsubscribe = subscribeSharedOnboardingCompletion(dismiss);
    notify();
    expect(dismiss).not.toHaveBeenCalled();
    mocks.read.mockReturnValue(completed);
    notify("other-preference");
    expect(dismiss).not.toHaveBeenCalled();
    notify();
    notify();
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(completed);
    unsubscribe();
    mocks.read.mockReturnValue({ ...completed, onboardingCompletedAt: "2026-09-26T14:00:00Z" });
    notify();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("keeps manually reopened setup open when another pane changes a preference", () => {
    mocks.read.mockReturnValue(completed);
    const dismiss = vi.fn();
    unsubscribe = subscribeSharedOnboardingCompletion(dismiss);
    mocks.read.mockReturnValue({ ...completed, wordWrap: false });
    notify();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("preserves durable completion when an older pane saves its preferences", async () => {
    mocks.read.mockReturnValue(completed);
    await persistClientSettingsWithCompletion({ ...DEFAULT_CLIENT_SETTINGS, wordWrap: false });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith({ ...completed, wordWrap: false });
  });
});
