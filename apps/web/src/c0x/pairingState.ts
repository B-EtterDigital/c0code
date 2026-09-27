export interface C0xPairingState {
  readonly version: 1;
  phase: "idle" | "submitting" | "authenticated";
}

declare global {
  interface Window {
    __c0xPairingState?: C0xPairingState;
  }
}

/** The shell reads lifecycle state, never a form element or a credential. */
export function registerC0xPairingState(state: C0xPairingState) {
  window.__c0xPairingState = state;
  return () => {
    if (window.__c0xPairingState === state) delete window.__c0xPairingState;
  };
}

export async function runC0xPairingExchange(
  state: C0xPairingState,
  exchange: () => Promise<string | null>,
) {
  state.phase = "submitting";
  try {
    const error = await exchange();
    state.phase = error === null ? "authenticated" : "idle";
    return error;
  } finally {
    // Unexpected rejections still reach the caller; the state cannot stay busy forever.
    if (state.phase === "submitting") state.phase = "idle";
  }
}
