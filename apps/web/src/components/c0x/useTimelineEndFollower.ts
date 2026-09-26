import { useCallback, useEffect, useRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { createTimelineEndFollower } from "./timelineEndFollower";

export function useTimelineEndFollower(
  listRef: { current: LegendListRef | null },
  owner: string | undefined,
) {
  const observer = useRef<ResizeObserver | null>(null);
  const observed = useRef<Element | null>(null);
  const controller = useRef<ReturnType<typeof createTimelineEndFollower> | null>(null);
  if (!controller.current)
    controller.current = createTimelineEndFollower({
      read: () => {
        const node = listRef.current?.getScrollableNode();
        if (!node) return null;
        const content = node.firstElementChild;
        if (content && content !== observed.current) {
          observer.current?.disconnect();
          observer.current = new ResizeObserver(() => controller.current?.changed());
          observer.current.observe(content);
          observer.current.observe(node);
          observed.current = content;
        }
        return { height: node.scrollHeight, viewport: node.clientHeight, offset: node.scrollTop };
      },
      jump: () => {
        // Materialize the virtual tail, then settle against its measured height.
        // An immediate jump respects reduced motion and avoids a long smooth
        // scroll repeatedly terminating at an obsolete estimated end.
        void listRef.current?.scrollToEnd({ animated: false }).catch((error) => {
          controller.current?.stop();
          console.error("[c0x-t3-error] timeline.jumpToEnd", error);
        });
      },
      request: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
    });
  const stop = useCallback(() => {
    controller.current?.stop();
    observer.current?.disconnect();
    observer.current = null;
    observed.current = null;
  }, []);
  useEffect(() => stop, [owner, stop]);
  return {
    start: useCallback(() => controller.current?.start(), []),
    changed: useCallback(() => controller.current?.changed(), []),
    stop,
  };
}
