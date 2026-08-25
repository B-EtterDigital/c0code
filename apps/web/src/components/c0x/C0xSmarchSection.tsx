/**
 * C0X patch: the SMARCH controls section of the right-panel launcher. The
 * toggles are OWNED by the C0VIBE shell (per-split flags, workspace skill
 * materialization, activation announcements) — this section renders the
 * shell-pushed state natively in the panel flow and posts each flip back over
 * the console channel. An optimistic flip keeps the switch honest during the
 * shell round-trip; the next config push settles it.
 */
import { useEffect, useState } from "react";

import type { C0xSmarchConfig } from "~/c0x/nativeShell";
import { postC0xShellEvent } from "~/c0x/nativeShell";
import { cn } from "~/lib/utils";

function C0xSwitch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full transition-colors",
        on ? "bg-info" : "bg-muted-foreground/30",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[2px] left-0 size-[14px] rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[16px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

export function C0xSmarchSection({ smarch }: { smarch: C0xSmarchConfig }) {
  // key → optimistic value, cleared whenever the shell pushes fresh state.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setOptimistic({});
  }, [smarch]);

  return (
    <section aria-label={smarch.title} data-c0x-smarch-section className="w-full">
      <h3 className="font-medium text-foreground text-sm">{smarch.title}</h3>
      <div className="mt-2 flex flex-col gap-1.5">
        {smarch.toggles.map((toggle) => {
          const on = optimistic[toggle.key] ?? toggle.enabled;
          return (
            <div
              key={toggle.key}
              className="flex items-center gap-3 rounded-lg border border-border/80 bg-card p-3 dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{toggle.title}</p>
                {toggle.blurb ? (
                  <p className="mt-0.5 truncate text-muted-foreground text-xs" title={toggle.blurb}>
                    {toggle.blurb}
                  </p>
                ) : null}
              </div>
              <C0xSwitch
                on={on}
                label={`${toggle.title} ${on ? "off" : "on"}`}
                onToggle={() => {
                  setOptimistic((current) => ({ ...current, [toggle.key]: !on }));
                  postC0xShellEvent({ type: "smarch-set", key: toggle.key, enabled: !on });
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
