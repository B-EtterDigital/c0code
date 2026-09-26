/** One end intent survives virtual-row measurements; manual navigation cancels it.
 * Frames are bounded and coalesced. There is no idle polling. */
export function createTimelineEndFollower(options: {
  read: () => { height: number; viewport: number; offset: number } | null;
  jump: () => void;
  request: (callback: () => void) => number;
  cancel: (id: number) => void;
}) {
  let following = false;
  let frame: number | null = null;
  let remaining = 0;
  let stable = 0;
  let lastHeight = -1;
  let forceJump = false;
  const stop = () => {
    following = false;
    if (frame !== null) options.cancel(frame);
    frame = null;
  };
  const tick = () => {
    frame = null;
    if (!following || remaining-- <= 0) return;
    const state = options.read();
    const atEnd = state && state.height - state.viewport - state.offset <= 1;
    stable = atEnd && state.height === lastHeight ? stable + 1 : 0;
    lastHeight = state?.height ?? -1;
    if (forceJump || !atEnd) { forceJump = false; options.jump(); }
    if (stable < 8) frame = options.request(tick);
  };
  const changed = () => {
    if (!following) return;
    remaining = 120;
    stable = 0;
    if (frame === null) frame = options.request(tick);
  };
  return {
    start() { following = true; forceJump = true; lastHeight = -1; changed(); },
    changed,
    stop,
  };
}
