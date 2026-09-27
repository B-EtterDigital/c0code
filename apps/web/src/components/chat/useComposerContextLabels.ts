import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveContextStripLabelsCompact } from "../BranchToolbar.logic";
import { resolveRestingComposerControlsNaturalWidth } from "../composerFooterLayout";
import { measureRestingComposerControls } from "./restingComposerControlsMeasurement";

/**
 * Collapse the strip's labels to icons only when the text no longer fits.
 *
 * Hidden labels stay measurable because their inner text keeps its natural
 * width while the outer layout box collapses. This lets every pass recompute
 * the expanded width without remembered values that could go stale or latch
 * the strip compact. A small hysteresis keeps the boundary from flapping.
 */
const COMPOSER_CONTEXT_MOTION_DURATION_MS = 180;
const COMPOSER_CONTEXT_MOTION_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const COMPOSER_CONTEXT_LABEL_SELECTOR = "[data-composer-label]";

export function useComposerContextLabels(element: HTMLDivElement | null): boolean {
  const [overflows, setOverflows] = useState(false);
  const pendingLabelRectsRef = useRef<Map<HTMLElement, DOMRect> | null>(null);
  const labelAnimationsRef = useRef(new Map<HTMLElement, Animation>());
  // Observer callbacks read the latest committed toolbar, without making
  // their subscriptions depend on the compact state they update.
  const stateRef = useRef({ element, overflows });

  const measure = useCallback(() => {
    const { element: current, overflows: compact } = stateRef.current;
    if (!current) return;
    const available = current.clientWidth;
    if (available === 0) return;
    // flex-1 stretches the groups to fill the strip, so their own boxes always
    // measure "full". Sum the laid-out content instead, skipping hidden form
    // artifacts and other out-of-flow nodes.
    const contentWidth = (parent: Element): number => {
      const gap = Number.parseFloat(getComputedStyle(parent).columnGap) || 0;
      let width = 0;
      let counted = 0;
      for (const child of parent.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.offsetWidth === 0) continue;
        const style = getComputedStyle(child);
        const position = style.position;
        if (position === "absolute" || position === "fixed") continue;
        width +=
          child.offsetWidth +
          (Number.parseFloat(style.marginInlineStart) || 0) +
          (Number.parseFloat(style.marginInlineEnd) || 0);
        counted += 1;
      }
      return width + gap * Math.max(0, counted - 1);
    };
    const stripGap = Number.parseFloat(getComputedStyle(current).columnGap) || 0;
    let needed = 0;
    let groups = 0;
    for (const child of current.children) {
      if (!(child instanceof HTMLElement)) continue;
      // The host itself flexes into all remaining room. Reserve the natural
      // width of the controls inside it, blocks in overflow included, so Git
      // labels compact before squeezing out the model picker. Reserving only
      // the visible controls would let the labels expand into room the
      // composer just freed, shrink the host, and hide the controls again.
      const hostedControls = child.matches('[data-chat-resting-composer-controls-host="true"]')
        ? child.querySelector<HTMLElement>('[data-chat-composer-resting-controls="true"]')
        : null;
      const hostedMeasurement = hostedControls
        ? measureRestingComposerControls(hostedControls)
        : null;
      const width = hostedMeasurement
        ? resolveRestingComposerControlsNaturalWidth(hostedMeasurement)
        : contentWidth(hostedControls ?? child);
      if (width <= 1) continue;
      groups += 1;
      needed += width;
    }
    needed += stripGap * Math.max(0, groups - 1);
    for (const label of current.querySelectorAll<HTMLElement>("[data-composer-label]")) {
      // The clipping can happen below the marker (SelectValue truncates
      // internally), where the outer span's scrollWidth matches its clipped
      // box. The text's real width is the largest scrollWidth in the subtree.
      let textWidth = label.scrollWidth;
      for (const inner of label.querySelectorAll<HTMLElement>("*")) {
        textWidth = Math.max(textWidth, inner.scrollWidth);
      }
      // Subtract the visible width even during an animation. The content
      // sum already includes it; only the hidden text needs reserving.
      needed += Math.max(0, textWidth - label.getBoundingClientRect().width);
    }
    const nextOverflows = resolveContextStripLabelsCompact({
      compact,
      neededWidth: needed,
      availableWidth: available,
    });
    if (nextOverflows !== compact) {
      pendingLabelRectsRef.current = new Map(
        Array.from(current.querySelectorAll<HTMLElement>(COMPOSER_CONTEXT_LABEL_SELECTOR)).map(
          (label) => [label, label.getBoundingClientRect()],
        ),
      );
    }
    setOverflows(nextOverflows);
  }, []);

  useLayoutEffect(() => {
    stateRef.current = { element, overflows };
    const previousRects = pendingLabelRectsRef.current;
    if (!previousRects) return;
    pendingLabelRectsRef.current = null;

    for (const animation of labelAnimationsRef.current.values()) {
      animation.cancel();
    }
    labelAnimationsRef.current.clear();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (const [label, previousRect] of previousRects) {
      if (!label.isConnected) continue;
      const nextWidth = label.getBoundingClientRect().width;
      if (Math.abs(previousRect.width - nextWidth) < 0.5) continue;

      // Animate the space occupied by each label so flex layout keeps the
      // trailing controls anchored. Translating the whole group after its
      // width snaps sends expanded text beyond the strip's right edge.
      const animation = label.animate(
        [
          { width: `${previousRect.width}px`, maxWidth: `${previousRect.width}px` },
          { width: `${nextWidth}px`, maxWidth: `${nextWidth}px` },
        ],
        {
          duration: COMPOSER_CONTEXT_MOTION_DURATION_MS,
          easing: COMPOSER_CONTEXT_MOTION_EASING,
          fill: "backwards",
        },
      );
      labelAnimationsRef.current.set(label, animation);
      animation.addEventListener(
        "finish",
        () => {
          if (labelAnimationsRef.current.get(label) === animation) {
            labelAnimationsRef.current.delete(label);
          }
        },
        { once: true },
      );
    }
  }, [element, overflows]);

  useEffect(
    () => () => {
      for (const animation of labelAnimationsRef.current.values()) {
        animation.cancel();
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!element) return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    const resize = new ResizeObserver(schedule);
    const root = document.documentElement;
    // An already-loaded font can change scrollWidth inside a clipped label
    // without resizing its box or emitting a font-loading event.
    const readTypography = () =>
      [
        "--font-sans",
        "--font-mono",
        "--font-composer",
        "font-size",
        "--font-size-prompt",
        "--font-size-code",
      ]
        .map((property) => root.style.getPropertyValue(property))
        .join("\0");
    let typography = readTypography();
    const observed = new Set<Element>();
    const observeLabels = () => {
      const next = new Set<Element>([
        element,
        ...element.querySelectorAll(`${COMPOSER_CONTEXT_LABEL_SELECTOR} > *`),
      ]);
      for (const node of observed) {
        if (!next.has(node)) {
          resize.unobserve(node);
          observed.delete(node);
        }
      }
      for (const node of next) {
        if (!observed.has(node)) {
          resize.observe(node);
          observed.add(node);
        }
      }
    };
    // Timeline scrolling also renders the composer. Unchanged controls must
    // not force width/layout reads on every one of those React commits.
    // Inner label sizes cover font changes while the outer label is clipped.
    const mutations = new MutationObserver((changes) => {
      if (changes.some((change) => change.type === "childList")) observeLabels();
      if (changes.some((change) => change.target !== root)) schedule();
      if (changes.some((change) => change.target === root)) {
        const next = readTypography();
        if (next !== typography) {
          typography = next;
          schedule();
        }
      }
    });
    observeLabels();
    mutations.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    mutations.observe(root, { attributes: true, attributeFilter: ["style"] });
    document.fonts.addEventListener("loadingdone", schedule);
    measure();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, [element, measure]);

  return overflows;
}
