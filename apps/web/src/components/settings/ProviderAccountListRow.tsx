import type { ReactNode } from "react";
import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { barColor } from "../usage/UsageLimits";

export function ProviderAccountListRow({
  name,
  instanceId,
  driver,
  icon,
  summary,
  statusDot,
  enabled,
  selected,
  readOnly,
  onSelect,
  onEnabledChange,
  advisory,
  updateCommand,
  onRunUpdate,
  isUpdating,
  onCopyCommand,
  usageLimits,
  sharedUpdate,
}: {
  readonly name: string;
  readonly instanceId: string;
  readonly driver: ProviderDriverKind;
  readonly icon: ReactNode;
  readonly summary: string;
  readonly statusDot: ReactNode;
  readonly enabled: boolean;
  readonly selected: boolean;
  readonly readOnly: boolean;
  readonly onSelect: (() => void) | undefined;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly advisory: string | undefined;
  readonly updateCommand: string | null;
  readonly onRunUpdate: (() => void) | undefined;
  readonly isUpdating: boolean;
  readonly onCopyCommand: () => void;
  readonly usageLimits: ServerProvider["usageLimits"];
  readonly sharedUpdate: boolean;
}) {
  const windows = usageLimits?.windows ?? [];
  const remaining = windows.length ? Math.min(...windows.map(remainingPercent)) : null;
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "group flex min-w-0 items-start gap-2 px-3 py-3 sm:px-4",
        selected ? "bg-muted/45" : "hover:bg-muted/25",
      )}
    >
      <div className="min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onSelect}
                aria-label={`Select ${name}`}
                aria-pressed={selected}
                className={cn(
                  "flex w-full min-w-0 items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !enabled && !selected && "opacity-60 group-hover:opacity-100",
                )}
              >
                {icon}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                    {name}
                  </span>
                  <span className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                    {statusDot}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{summary}</span>
                  </span>
                </span>
              </button>
            }
          />
          <TooltipPopup>{instanceId}</TooltipPopup>
        </Tooltip>
        {remaining !== null ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <div
              role="meter"
              aria-label={`${name} remaining quota`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={remaining}
              className="h-1 max-w-24 min-w-8 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${remaining}%`,
                  backgroundColor: remaining === 0 ? "var(--destructive)" : barColor(driver),
                }}
              />
            </div>
            <span className="shrink-0 tabular-nums">{remaining}% left</span>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
        <Switch
          checked={enabled}
          disabled={readOnly}
          onCheckedChange={onEnabledChange}
          aria-label={`Enable ${name}`}
        />
        {advisory ? (
          onRunUpdate && !sharedUpdate ? (
            <Button
              size="xs"
              variant="outline"
              disabled={readOnly || isUpdating}
              onClick={onRunUpdate}
            >
              {isUpdating ? <Spinner /> : <DownloadIcon />} {isUpdating ? "Updating…" : "Update"}
            </Button>
          ) : (
            <Popover>
              <PopoverTrigger
                render={
                  <Button size="xs" variant="outline" disabled={readOnly || isUpdating}>
                    {isUpdating ? <Spinner /> : <DownloadIcon />}
                    {isUpdating ? "Updating…" : "Update"}
                  </Button>
                }
              />
              <PopoverPopup side="bottom" align="end" className="w-[min(21rem,calc(100vw-1.5rem))]">
                <div className="grid gap-3 text-xs">
                  <p className="text-foreground">{advisory}</p>
                  <p className="text-muted-foreground">
                    {onRunUpdate
                      ? "This updates the CLI once and refreshes its accounts."
                      : !enabled
                        ? "Enable this account to use its updater, or run the command below on this computer."
                        : "This installation cannot update automatically. Use the command below on this computer, then refresh Providers."}
                  </p>
                  {onRunUpdate ? (
                    <Button size="xs" variant="outline" onClick={onRunUpdate} disabled={isUpdating}>
                      Update all instances using this binary
                    </Button>
                  ) : null}
                  {updateCommand ? (
                    <div className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-muted/40 p-2">
                      <code className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {updateCommand}
                      </code>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={onCopyCommand}
                        aria-label="Copy update command"
                      >
                        <CopyIcon />
                      </Button>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      No update command was reported. Open this account’s settings to check its CLI
                      path.
                    </p>
                  )}
                </div>
              </PopoverPopup>
            </Popover>
          )
        ) : null}
      </div>
    </div>
  );
}
