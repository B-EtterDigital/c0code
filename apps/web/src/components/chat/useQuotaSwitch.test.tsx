import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useQuotaSwitch } from "./useQuotaSwitch";

const mocks = vi.hoisted(() => ({ discover: vi.fn(), mode: "ask" }));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({ usageLimitSwitch: mocks.mode }),
  useUpdateEnvironmentSettings: () => vi.fn(),
  usePrimarySettings: () => ({}),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { switchCandidates: "switchCandidates" },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.discover }));

let hook: ReturnType<typeof useQuotaSwitch>;
let root: ReactTestRenderer;
function Probe({ thread = "thread" }: { thread?: string }) {
  hook = useQuotaSwitch(EnvironmentId.make("environment"), ThreadId.make(thread));
  return null;
}
function exhausted(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("poly"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [],
    skills: [],
    slashCommands: [],
    usageLimits: {
      checkedAt: new Date().toISOString(),
      windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 100 }],
    },
  };
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.mode = "ask";
  mocks.discover.mockReset();
  await act(async () => {
    root = create(<Probe />);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("quota send decision", () => {
  it("cancels immediately while discovery is pending and ignores its late response", async () => {
    let complete!: (value: unknown) => void;
    mocks.discover.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    let pending!: ReturnType<typeof hook.check>;
    await act(async () => {
      pending = hook.check(exhausted());
    });
    await act(async () => {
      hook.dialog.props.onOpenChange(false);
    });
    expect(await pending).toBeNull();
    await act(async () => {
      complete({ _tag: "Success", value: [] });
    });
    expect(hook.dialog.props.open).toBe(false);
  });
  it("does not replace a pending send on repeated Enter", async () => {
    mocks.discover.mockResolvedValue({ _tag: "Success", value: [] });
    let first!: ReturnType<typeof hook.check>;
    await act(async () => {
      first = hook.check(exhausted());
    });
    expect(await hook.check(exhausted())).toBeNull();
    expect(mocks.discover).toHaveBeenCalledTimes(1);
    await act(async () => {
      hook.dialog.props.onOpenChange(false);
    });
    expect(await first).toBeNull();
  });
  it("cancels a send when its thread unmounts", async () => {
    mocks.discover.mockResolvedValue({ _tag: "Success", value: [] });
    let pending!: ReturnType<typeof hook.check>;
    await act(async () => {
      pending = hook.check(exhausted());
    });
    await act(async () => {
      root.update(<Probe thread="another" />);
    });
    expect(await pending).toBeNull();
    expect(hook.dialog.props.open).toBe(false);
  });
  it("automatically chooses a compatible account once, without claiming a send succeeded", async () => {
    mocks.mode = "auto";
    await act(async () => {
      root.update(<Probe />);
    });
    const candidate = {
      instanceId: ProviderInstanceId.make("better"),
      driver: ProviderDriverKind.make("codex"),
      displayName: "Better GPT",
      enabled: true,
      keepsConversation: true,
      usageLimits: {
        checkedAt: new Date().toISOString(),
        windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 20 }],
      },
    };
    mocks.discover.mockResolvedValue({ _tag: "Success", value: [candidate] });
    let pending!: ReturnType<typeof hook.check>;
    await act(async () => {
      pending = hook.check(exhausted());
    });
    expect(await pending).toEqual(candidate);
    expect(hook.notice).toBeNull();
    expect(hook.dialog.props.open).toBe(false);
  });
});
