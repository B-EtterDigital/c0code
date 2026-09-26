import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { C0xEffortSlider } from "./C0xEffortSlider";

vi.mock("../ui/tooltip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/tooltip")>();
  const { cloneElement } = await import("react");
  return {
    ...actual,
    Tooltip: ({ children }: { children: ReactNode }) => children,
    TooltipTrigger: ({
      children,
      render,
    }: {
      children: ReactNode;
      render?: import("react").ReactElement;
    }) => cloneElement(render ?? <span />, {}, children),
    TooltipPopup: () => null,
  };
});

vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  PopoverPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
let renderer: ReactTestRenderer;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});
const options = [
  { id: "low", label: "Low" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];

it("uses the provider stops and forwards reset, fast and model actions", async () => {
  const onChange = vi.fn(),
    onReset = vi.fn(),
    onToggleFast = vi.fn(),
    onOpenModelPicker = vi.fn();
  await act(() => {
    renderer = create(
      <C0xEffortSlider
        options={options}
        effort="high"
        onChange={onChange}
        onReset={onReset}
        onToggleFast={onToggleFast}
        onOpenModelPicker={onOpenModelPicker}
        modelLabel="Configured model"
        fastEnabled
      />,
    );
  });
  const slider = renderer.root.findByProps({ role: "slider" });
  expect(slider.props["aria-valuemax"]).toBe(2);
  expect(slider.props["aria-valuetext"]).toBe("High");
  await act(() => slider.props.onKeyDown({ key: "End", preventDefault: vi.fn() }));
  expect(onChange).toHaveBeenCalledWith("xhigh");
  for (const label of ["Fast mode", "Reset effort", "Choose model"])
    await act(() => renderer.root.findByProps({ "aria-label": label }).props.onClick());
  expect(onToggleFast).toHaveBeenCalledOnce();
  expect(onReset).toHaveBeenCalledOnce();
  expect(onOpenModelPicker).toHaveBeenCalledOnce();
  expect(renderer.root.findByProps({ "aria-label": "Fast mode" }).props["aria-pressed"]).toBe(true);
});

it("blocks unsupported and unavailable provider controls without inventing values", async () => {
  const onChange = vi.fn();
  await act(() => {
    renderer = create(
      <C0xEffortSlider options={options.slice(0, 1)} effort="low" disabled onChange={onChange} />,
    );
  });
  await act(() =>
    renderer.root
      .findByProps({ role: "slider" })
      .props.onKeyDown({ key: "End", preventDefault: vi.fn() }),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ "aria-label": "Fast mode" }).props.disabled).toBe(true);
  expect(renderer.root.findByProps({ "aria-label": "Choose model" }).props.disabled).toBe(true);
});
