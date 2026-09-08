import { useCallback, useEffect, useState } from "react";
import type {
  C0xComposerMediaState,
  C0xMediaPreferences,
} from "../components/c0x/C0xComposerMediaControls";
import { postC0xShellEvent, useC0xShellConfig } from "./nativeShell";

export interface C0xComposerMediaRequest {
  type: "composer-media";
  action: "read-state" | "start" | "stop" | "capture" | "preferences" | "submitted";
  targetKey: string;
  requestId: string;
  preferences?: Partial<C0xMediaPreferences>;
  mediaIds?: string[];
}

const EMPTY_STATE: C0xComposerMediaState = {
  ready: false,
  recording: false,
  busy: false,
  microphoneAvailable: false,
  captureAvailable: false,
  error: null,
  waveform: [],
  pipelines: [],
  projects: [],
  dictationSessions: [],
  captureSessions: [],
  preferences: {
    pipelineId: "",
    captureMode: "region",
    autosaveEnabled: true,
    projectId: "",
    transcriptionSessionId: "",
    captureSessionId: "",
  },
};

/** Native controls request operations; only the host reports recording/capture state. */
export function useC0xComposerMedia(targetKey: string) {
  const shell = useC0xShellConfig();
  const enabled = shell.modules.length > 0;
  const [snapshot, setSnapshot] = useState<{ targetKey: string; state: C0xComposerMediaState } | null>(null);
  const request = useCallback((action: C0xComposerMediaRequest["action"], preferences?: Partial<C0xMediaPreferences>) => {
    if (!enabled) return;
    postC0xShellEvent({ type: "composer-media", action, targetKey, requestId: crypto.randomUUID(),
      ...(preferences ? { preferences } : {}),
    });
  }, [enabled, targetKey]);

  useEffect(() => {
    if (!enabled) return;
    const receive = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : null;
      if (!detail || typeof detail !== "object" || !("targetKey" in detail) || detail.targetKey !== targetKey) return;
      const state = "state" in detail ? detail.state : null;
      if (!state || typeof state !== "object" || !("ready" in state) || typeof state.ready !== "boolean"
        || !("preferences" in state) || !state.preferences
        || !("waveform" in state) || !Array.isArray(state.waveform)
        || !("pipelines" in state) || !Array.isArray(state.pipelines)
        || !("projects" in state) || !Array.isArray(state.projects)
        || !("dictationSessions" in state) || !Array.isArray(state.dictationSessions)
        || !("captureSessions" in state) || !Array.isArray(state.captureSessions)) {
        postC0xShellEvent({ type: "composer-media-error", operation: "state", message: "The host returned an invalid composer media state." });
        return;
      }
      setSnapshot({ targetKey, state: state as C0xComposerMediaState });
    };
    window.addEventListener("c0x-composer-media-state", receive);
    request("read-state");
    return () => window.removeEventListener("c0x-composer-media-state", receive);
  }, [enabled, request, targetKey]);

  return {
    enabled,
    state: snapshot?.targetKey === targetKey ? snapshot.state : EMPTY_STATE,
    onAction: (action: "start" | "stop" | "capture") => request(action),
    onPreferencesChange: (preferences: Partial<C0xMediaPreferences>) => request("preferences", preferences),
  };
}
