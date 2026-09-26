import * as React from 'react';
import { ChevronDownIcon, ChevronRightIcon, RotateCcwIcon, ZapIcon } from 'lucide-react';
import { Popover, PopoverPopup, PopoverTrigger } from '../ui/popover';
import { composerFloatingLayerProps } from '../chat/composerEventScope';

/** The original effort popover; all options and actions come from the running provider. */
export function C0xEffortSlider({ disabled = false, effort, onChange, options,
  modelLabel, onOpenModelPicker, fastEnabled, onToggleFast, onReset,
}: {
  disabled?: boolean;
  effort: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ id: string; label: string }>;
  modelLabel?: string;
  onOpenModelPicker?: (() => void) | undefined;
  fastEnabled?: boolean;
  onToggleFast?: (() => void) | undefined;
  onReset?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const index = Math.max(0, options.findIndex((option) => option.id === effort));
  const current = options[index] ?? options[0];
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const moveTo = React.useCallback((next: number) => {
    if (disabled) return;
    const option = options[Math.min(options.length - 1, Math.max(0, next))];
    if (option && option.id !== effort) onChange(option.id);
  }, [disabled, effort, onChange, options]);
  const pickFromPointer = React.useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || options.length < 2) return;
    moveTo(Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (options.length - 1)));
  }, [moveTo, options.length]);
  const percent = options.length > 1 ? (index / (options.length - 1)) * 100 : 0;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger aria-label="Select effort" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
      Select effort <ChevronDownIcon className="size-3" />
    </PopoverTrigger>
    <PopoverPopup side="top" align="center" className="w-64 rounded-2xl border border-border bg-popover text-popover-foreground" viewportClassName="px-3 py-2" {...composerFloatingLayerProps}>
      <div data-testid="c0code-effort-slider">
        <div className="flex items-start justify-between gap-2">
          <button type="button" aria-label="Fast mode" aria-pressed={fastEnabled === true} disabled={disabled || !onToggleFast} title={onToggleFast ? 'Fast mode' : 'Fast mode is unavailable for this model'} onClick={onToggleFast} className={`rounded-md p-1.5 disabled:opacity-30 ${fastEnabled ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300' : 'text-muted-foreground hover:bg-accent'}`}><ZapIcon className="size-4" /></button>
          <button type="button" aria-label="Choose model" disabled={!onOpenModelPicker} onClick={() => { setOpen(false); onOpenModelPicker?.(); }} className="flex min-w-0 flex-1 flex-col items-center rounded-lg px-1 py-0.5 hover:bg-accent">
            <span className="inline-flex items-center gap-1 font-semibold text-violet-600 dark:text-violet-300">{current?.label ?? 'Effort'}<ChevronRightIcon className="size-3" /></span>
            <span className="max-w-full truncate text-[10px] text-muted-foreground">{modelLabel ?? 'Current model'}</span>
          </button>
          <button type="button" aria-label="Reset effort" disabled={disabled || !onReset} onClick={onReset} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"><RotateCcwIcon className="size-4" /></button>
        </div>
        <div ref={trackRef} role="slider" aria-label="Reasoning effort" aria-disabled={disabled || undefined} aria-valuemin={0} aria-valuemax={Math.max(0, options.length - 1)} aria-valuenow={index} aria-valuetext={current?.label ?? ''} tabIndex={disabled ? -1 : 0}
          className={`relative mx-2 mb-1 mt-2 h-6 touch-none select-none rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
          onKeyDown={(event) => {
            const offset = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : 0;
            if (offset || event.key === 'Home' || event.key === 'End') {
              event.preventDefault(); moveTo(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index + offset);
            }
          }}
          onPointerDown={(event) => { if (!disabled) { event.currentTarget.setPointerCapture(event.pointerId); pickFromPointer(event.clientX); } }}
          onPointerMove={(event) => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) pickFromPointer(event.clientX); }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-linear-to-r from-violet-300 via-violet-500 to-blue-500 shadow-[0_0_9px_#8b5cf655]" />
          {options.map((option, stop) => <span aria-hidden="true" key={option.id} className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/65" style={{ left: `${options.length > 1 ? stop / (options.length - 1) * 100 : 0}%` }} />)}
          <span aria-hidden="true" className="absolute top-1/2 size-3.5 rounded-full bg-white shadow ring-1 ring-violet-300" style={{ left: `${percent}%`, transform: 'translate(-50%, -50%)' }} />
        </div>
      </div>
    </PopoverPopup>
  </Popover>;
}
