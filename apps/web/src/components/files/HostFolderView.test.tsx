import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HostFolderView } from "./HostFolderView";
import { useRevealInFileManager } from "../../hooks/useRevealInFileManager";

const mocks = vi.hoisted(() => ({ config: vi.fn(), reveal: vi.fn(), copy: vi.fn() }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.config() }));
vi.mock("../../state/server", () => ({ serverEnvironment: { configValueAtom: vi.fn() } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.reveal }));
vi.mock("../../hooks/useCopyToClipboard", () => ({
  writeTextToClipboard: (...args: unknown[]) => mocks.copy(...args),
}));
vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
let renderer: ReactTestRenderer;
const environmentId = EnvironmentId.make("computer-1");
const path = "/home/test/Videos/byteplus-live-check";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.config.mockReturnValue({
    shellRevealInFileManager: true,
    availableEditors: ["file-manager"],
    environment: { platform: { os: "linux" } },
  });
  mocks.reveal.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  mocks.copy.mockReset().mockResolvedValue(true);
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function renderFolder() {
  await act(() => {
    renderer = create(<HostFolderView environmentId={environmentId} path={path} />);
  });
}

describe("external folder view", () => {
  it("shows the full path and uses the shared reveal command on the selected computer", async () => {
    await renderFolder();
    expect(renderer.root.findByProps({ "data-folder-path": path }).children).toEqual([path]);
    const reveal = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Reveal in Files"));
    expect(reveal).toBeDefined();
    await act(() => reveal!.props.onClick());
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: path, editor: "file-manager", reveal: false },
    });
  });

  it("keeps the existing file reveal behavior for chat links", async () => {
    function ChatFileAction() {
      const { revealFileInFileManager } = useRevealInFileManager(environmentId);
      return <button onClick={() => revealFileInFileManager(path + "/clip.mp4")}>Reveal</button>;
    }
    await act(() => {
      renderer = create(<ChatFileAction />);
    });
    await act(() => renderer.root.findByType("button").props.onClick());
    expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: path + "/clip.mp4", editor: "file-manager", reveal: true },
    });
  });

  it.each([
    { shellRevealInFileManager: false, availableEditors: ["file-manager"] },
    { shellRevealInFileManager: true, availableEditors: [] },
  ])("offers Copy only when shell capabilities are unavailable: %j", async (config) => {
    mocks.config.mockReturnValue({ ...config, environment: { platform: { os: "linux" } } });
    await renderFolder();
    expect(renderer.root.findAllByType("button")).toHaveLength(1);
    await act(() => renderer.root.findByType("button").props.onClick());
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(path, "folder path");
    expect(mocks.reveal).not.toHaveBeenCalled();
    expect(renderer.root.findByType("button").children).toContain("Copied");
  });
});
