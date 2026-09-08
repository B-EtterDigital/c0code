import * as React from 'react';

/** C0VIBE's effort slider, using the running model's real supported stops. */
export function C0xEffortSlider({
  disabled = false,
  effort,
  onChange,
  options,
}: {
  disabled?: boolean;
  effort: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ id: string; label: string }>;
}) {
  const index = Math.max(0, options.findIndex((option) => option.id === effort));
  const current = options[index] ?? options[0];
  const trackRef = React.useRef<HTMLDivElement | null>(null);

  const moveTo = React.useCallback((next: number) => {
    if (disabled) return;
    const clamped = Math.min(options.length - 1, Math.max(0, next));
    const option = options[clamped];
    if (option && option.id !== effort) onChange(option.id);
  }, [disabled, effort, onChange, options]);

  // A pointer anywhere on the track picks the NEAREST stop, so the control is
  // usable without hitting a 12px dot.
  const pickFromPointer = React.useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || options.length < 2) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    moveTo(Math.round(ratio * (options.length - 1)));
  }, [moveTo, options.length]);

  const percent = options.length > 1 ? (index / (options.length - 1)) * 100 : 0;

  return (
    <div className="flex items-center gap-2" data-testid="c0code-effort-slider">
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        {current?.label ?? "Effort"}
      </span>
      <div
        ref={trackRef}
        aria-disabled={disabled || undefined}
        aria-label={"Reasoning effort"}
        aria-valuemax={options.length - 1}
        aria-valuemin={0}
        aria-valuenow={index}
        aria-valuetext={current?.label ?? ''}
        className={`relative h-5 w-28 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
        onKeyDown={(event) => {
          const key = event.key;
          if (key === 'ArrowLeft' || key === 'ArrowDown') { event.preventDefault(); moveTo(index - 1); }
          else if (key === 'ArrowRight' || key === 'ArrowUp') { event.preventDefault(); moveTo(index + 1); }
          else if (key === 'Home') { event.preventDefault(); moveTo(0); }
          else if (key === 'End') { event.preventDefault(); moveTo(options.length - 1); }
        }}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pickFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          pickFromPointer(event.clientX);
        }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
      >
        {/* rail */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200 dark:bg-white/10" />
        {/* filled portion, to the current stop */}
        {/* Full width, scaled on X: animating `width` is animating layout,
            which the motion law forbids. Origin-left so it grows from the start
            of the rail. */}
        <div
          className="c0code-effort-track-fill absolute inset-x-0 top-1/2 h-1.5 origin-left -translate-y-1/2 rounded-full bg-cyan-500 dark:bg-cyan-400"
          style={{ transform: `translateY(-50%) scaleX(${percent / 100})` }}
        />
        {/* stops */}
        {options.map((option, stop) => (
          <span
            aria-hidden="true"
            className={`absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              stop <= index ? 'bg-white/70' : 'bg-slate-400/70 dark:bg-white/30'
            }`}
            key={option.id}
            style={{ left: `${options.length > 1 ? (stop / (options.length - 1)) * 100 : 0}%` }}
          />
        ))}
        {/* knob */}
        <span
          aria-hidden="true"
          className="c0code-effort-knob absolute top-1/2 h-3.5 w-3.5 rounded-full bg-white shadow ring-1 ring-slate-300 dark:ring-white/20"
          style={{ left: `${percent}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>
    </div>
  );
}
