import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerContextLabels } from "./useComposerContextLabels";

let root: Root;
let available: number;
let natural: number;
let widthReads: number;
let compact: boolean;
let fonts: EventTarget;
let strip: MeasuredElement;
let rootStyle: Map<string, string>;
let documentRoot: HTMLElement;
const observers: { resize?: ResizeProbe; mutations?: MutationProbe } = {};
let frameId: number;
let frames: Map<number, FrameRequestCallback>;

class MeasuredElement {
  children: MeasuredElement[] = [];
  isConnected = true;
  constructor(readonly kind: string) {}
  get clientWidth() {
    if (this.kind === "strip") {
      widthReads += 1;
      return available;
    }
    return 80;
  }
  get offsetWidth() {
    return 80;
  }
  get scrollWidth() {
    return natural;
  }
  matches() {
    return false;
  }
  querySelector() {
    return null;
  }
  querySelectorAll(selector: string): MeasuredElement[] {
    if (this.kind === "strip") return selector.includes(">") ? [text] : [label];
    return this.kind === "label" ? [text] : [];
  }
  getBoundingClientRect() {
    return { width: 80 };
  }
}
const label = new MeasuredElement("label");
const text = new MeasuredElement("text");

class ResizeProbe {
  nodes = new Set<Element>();
  disconnect = vi.fn(() => this.nodes.clear());
  constructor(readonly callback: ResizeObserverCallback) {
    observers.resize = this;
  }
  observe(node: Element) {
    this.nodes.add(node);
  }
  unobserve(node: Element) {
    this.nodes.delete(node);
  }
  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

class MutationProbe {
  nodes = new Set<Node>();
  disconnect = vi.fn();
  constructor(readonly callback: MutationCallback) {
    observers.mutations = this;
  }
  observe(node: Node) {
    this.nodes.add(node);
  }
  notify(type: MutationRecordType = "characterData", target = strip as unknown as Node) {
    if (this.nodes.has(target)) {
      this.callback([{ type, target } as MutationRecord], this as unknown as MutationObserver);
    }
  }
}

function Probe({ element }: { element: HTMLDivElement | null }) {
  const value = useComposerContextLabels(element);
  useLayoutEffect(() => {
    compact = value;
  }, [value]);
  return null;
}

async function render(element = strip as unknown as HTMLDivElement) {
  await act(() => root.render(<Probe element={element} />));
}

async function flushFrame() {
  await act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

beforeEach(() => {
  available = 100;
  natural = 140;
  widthReads = 0;
  frameId = 0;
  frames = new Map();
  fonts = new EventTarget();
  rootStyle = new Map();
  documentRoot = {
    style: { getPropertyValue: (name: string) => rootStyle.get(name) ?? "" },
  } as unknown as HTMLElement;
  strip = new MeasuredElement("strip");
  const group = new MeasuredElement("group");
  group.children = [new MeasuredElement("control")];
  strip.children = [group];
  const document = {
    nodeType: 9,
    documentElement: documentRoot,
    fonts,
    addEventListener() {},
    removeEventListener() {},
  };
  const container = {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: EventTarget,
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal("HTMLElement", MeasuredElement);
  vi.stubGlobal("ResizeObserver", ResizeProbe);
  vi.stubGlobal("MutationObserver", MutationProbe);
  vi.stubGlobal("getComputedStyle", () => ({
    columnGap: "0",
    position: "static",
    marginInlineStart: "0",
    marginInlineEnd: "0",
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(container as unknown as HTMLElement);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("composer context label layout", () => {
  it("does not read layout again when an unrelated React update rerenders the composer", async () => {
    await render();
    expect(compact).toBe(true);
    const measured = widthReads;
    for (let i = 0; i < 10; i += 1) await render();
    expect(widthReads).toBe(measured);
    expect(frames.size).toBe(0);
  });

  it("expands and compacts after real width changes, coalescing resize bursts", async () => {
    await render();
    const measured = widthReads;
    available = 200;
    for (let i = 0; i < 10; i += 1) observers.resize!.notify();
    expect(frames.size).toBe(1);
    await flushFrame();
    expect(compact).toBe(false);
    expect(widthReads).toBe(measured + 1);
    available = 100;
    observers.resize!.notify();
    await flushFrame();
    expect(compact).toBe(true);
  });

  it("remeasures changed label content and intrinsic font widths without a strip resize", async () => {
    available = 200;
    await render();
    expect(compact).toBe(false);
    natural = 250;
    observers.mutations!.notify();
    await flushFrame();
    expect(compact).toBe(true);
    expect(observers.resize!.nodes.has(text as unknown as Element)).toBe(true);
    natural = 100;
    observers.resize!.notify();
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(frames.size).toBe(1);
    await flushFrame();
    expect(compact).toBe(false);
  });

  it("disconnects old observers and cancels pending reads when the toolbar is replaced", async () => {
    await render();
    const oldResize = observers.resize!;
    const oldMutations = observers.mutations!;
    observers.mutations!.notify("childList");
    expect(frames.size).toBe(1);
    await act(() => root.render(<Probe element={null} />));
    expect(oldResize.disconnect).toHaveBeenCalledOnce();
    expect(oldMutations.disconnect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    const measured = widthReads;
    fonts.dispatchEvent(new Event("loadingdone"));
    await flushFrame();
    expect(widthReads).toBe(measured);
  });

  it("remeasures an already-loaded font change in clipped labels, but ignores unrelated root styles", async () => {
    available = 100;
    await render();
    expect(compact).toBe(true);
    const measured = widthReads;
    rootStyle.set("--accent-color", "cyan");
    observers.mutations!.notify("attributes", documentRoot);
    await flushFrame();
    expect(widthReads).toBe(measured);
    // Box widths and font-loading state stay unchanged; only intrinsic text
    // width changes when a narrower installed font is selected.
    natural = 50;
    rootStyle.set("--font-sans", "monospace");
    observers.mutations!.notify("attributes", documentRoot);
    await flushFrame();
    expect(compact).toBe(false);
    expect(widthReads).toBe(measured + 1);
  });
});
