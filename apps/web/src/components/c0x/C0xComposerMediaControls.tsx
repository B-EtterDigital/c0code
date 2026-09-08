import { CameraIcon, CircleAlertIcon, MicIcon, SquareIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { Popover, PopoverPopup } from "../ui/popover";

export interface C0xMediaOption {
  id: string;
  title: string;
  disabled?: boolean;
}

export interface C0xMediaPreferences {
  pipelineId: string;
  captureMode: "region" | "window";
  autosaveEnabled: boolean;
  projectId: string;
  transcriptionSessionId: string;
  captureSessionId: string;
}

/** All status and choices come from the host's C0DIC/C0CAP controllers. */
export interface C0xComposerMediaState {
  ready: boolean;
  recording: boolean;
  busy: boolean;
  microphoneAvailable: boolean;
  captureAvailable: boolean;
  error: string | null;
  waveform: readonly number[];
  pipelines: readonly C0xMediaOption[];
  projects: readonly C0xMediaOption[];
  dictationSessions: readonly C0xMediaOption[];
  captureSessions: readonly C0xMediaOption[];
  preferences: C0xMediaPreferences;
}

function DestinationSelect({ label, value, options, disabled, emptyLabel = "Use current destination", onChange }: {
  label: string;
  value: string;
  options: readonly C0xMediaOption[];
  disabled?: boolean;
  emptyLabel?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      {label}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 rounded-md border border-border bg-popover px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
        {emptyLabel !== null ? <option value="">{emptyLabel}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.title}</option>)}
      </select>
    </label>
  );
}

export function C0xComposerMediaControls({ state, onAction, onPreferencesChange }: {
  state: C0xComposerMediaState;
  onAction: (action: "start" | "stop" | "capture") => void;
  onPreferencesChange: (preferences: Partial<C0xMediaPreferences>) => void;
}) {
  const [menu, setMenu] = useState<"dictation" | "capture" | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const preferences = state.preferences;
  const dictation = menu === "dictation";
  const autosave = preferences.autosaveEnabled;
  const projectId = preferences.projectId;
  const sessionId = dictation ? preferences.transcriptionSessionId : preferences.captureSessionId;
  const openMenu = (kind: "dictation" | "capture", element: HTMLElement) => {
    anchor.current = element;
    setMenu(kind);
  };
  return (
    <div data-c0x-composer-media aria-busy={state.busy} className="flex min-w-0 shrink-0 items-center gap-0.5">
      {state.recording && state.waveform.length > 0 ? (
        <div aria-label="Microphone input level" role="img"
          className="flex h-6 max-w-32 items-center justify-end gap-0.5 overflow-hidden"
          style={{ width: `${Math.min(128, state.waveform.length * 4)}px` }}>
          {state.waveform.slice(-32).map((level, index, samples) => (
            <span key={index} className="h-5 w-0.5 shrink-0 rounded-full transition-transform motion-reduce:transition-none"
              style={{
                backgroundColor: `color-mix(in srgb, #f97316 ${100 - index / Math.max(1, samples.length - 1) * 100}%, #eab308)`,
                transform: `scaleY(${Math.max(0.08, Math.min(1, Number.isFinite(level) ? level : 0))})`,
              }} />
          ))}
        </div>
      ) : null}
      <Button type="button" variant="ghost" size="icon-xs"
        aria-label={state.recording ? "Stop dictation" : "Start dictation"}
        title={state.recording ? "Stop dictation" : "Dictate · right-click for settings"}
        disabled={!state.ready || !state.microphoneAvailable || state.busy}
        onClick={() => onAction(state.recording ? "stop" : "start")}
        onContextMenu={(event) => { event.preventDefault(); openMenu("dictation", event.currentTarget); }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault(); openMenu("dictation", event.currentTarget);
          }
        }}
        className={state.recording ? "text-orange-600 dark:text-orange-400" : undefined}>
        {state.recording ? <SquareIcon className="size-3 fill-current" /> : <MicIcon className="size-3.5" />}
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Capture image"
        title="Capture image · right-click for settings"
        disabled={!state.ready || !state.captureAvailable || state.busy}
        onClick={() => onAction("capture")}
        onContextMenu={(event) => { event.preventDefault(); openMenu("capture", event.currentTarget); }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault(); openMenu("capture", event.currentTarget);
          }
        }}>
        <CameraIcon className="size-3.5" />
      </Button>
      {state.error ? <span role="alert" aria-label={state.error} title={state.error} className="text-destructive">
        <CircleAlertIcon className="size-3.5" />
      </span> : null}
      <Popover open={menu !== null} onOpenChange={(open) => { if (!open) setMenu(null); }}>
        <PopoverPopup anchor={anchor} align="end" side="top" sideOffset={8} className="w-72">
          <div className="flex flex-col gap-3 p-1">
            <div className="text-sm font-medium">{dictation ? "Dictation" : "Capture"}</div>
            {dictation ? (
              <DestinationSelect label="Transcription pipeline" value={preferences.pipelineId}
                emptyLabel="Use selected C0DIC pipeline"
                options={state.pipelines} disabled={state.recording || state.busy}
                onChange={(pipelineId) => onPreferencesChange({ pipelineId })} />
            ) : (
              <DestinationSelect label="Capture area" value={preferences.captureMode}
                emptyLabel={null}
                options={[{ id: "region", title: "Region" }, { id: "window", title: "Window" }]}
                disabled={state.busy}
                onChange={(captureMode) => {
                  if (captureMode === "region" || captureMode === "window") onPreferencesChange({ captureMode });
                }} />
            )}
            <label className="flex items-center justify-between gap-3 text-sm">
              Autosave
              <input type="checkbox" checked={autosave} disabled={state.busy || state.recording}
                onChange={(event) => onPreferencesChange({ autosaveEnabled: event.target.checked })} />
            </label>
            <DestinationSelect label="C0Vibe project" value={projectId} options={state.projects}
              disabled={!autosave || state.busy || state.recording}
              onChange={(id) => onPreferencesChange({ projectId: id, transcriptionSessionId: "", captureSessionId: "" })} />
            <DestinationSelect label="Session" value={sessionId}
              options={dictation ? state.dictationSessions : state.captureSessions}
              disabled={!autosave || state.busy || state.recording}
              onChange={(id) => onPreferencesChange(dictation
                ? { transcriptionSessionId: id } : { captureSessionId: id })} />
            {!autosave ? <p className="text-xs text-muted-foreground">Keep temporary media until the message is accepted.</p> : null}
            {state.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
