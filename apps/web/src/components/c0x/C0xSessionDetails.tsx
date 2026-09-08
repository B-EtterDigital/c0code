import {
  File,
  FileQuestion,
  Globe2,
  Image as ImageIcon,
  Plus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  deriveC0xSessionDetails,
  sessionDetailProvenanceLabel,
  type C0xSessionDetailsModel,
  type C0xSessionDetailsThread,
  type SessionDetailEntry,
  type SessionDetailIcon,
} from "~/c0x/sessionDetails";
import type { ChatAttachment, ChatMessage } from "~/types";

import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import "./C0xSessionDetails.css";

export interface C0xSessionOpenHandlers {
  readonly onOpenAttachment?: ((attachment: ChatAttachment) => void) | undefined;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  /** Wrap async bridge failures before passing the established app opener here. */
  readonly onOpenUrl?: ((url: string) => void) | undefined;
}

/** Parent-owned controls that can be placed beside this unit when real actions exist. */
export interface C0xSessionDetailsControls {
  readonly onOpenEnvironment?: (() => void) | undefined;
  readonly onOpenGit?: (() => void) | undefined;
  readonly onOpenSchedule?: (() => void) | undefined;
}

interface C0xSessionDataProps {
  readonly activities?: ReadonlyArray<OrchestrationThreadActivity> | undefined;
  readonly messages?: ReadonlyArray<ChatMessage> | undefined;
  readonly thread: C0xSessionDetailsThread;
}

export interface C0xSessionSummaryProps extends C0xSessionDataProps, C0xSessionOpenHandlers {
  readonly onAddOutput?: (() => void) | undefined;
  readonly onAddSource?: (() => void) | undefined;
  readonly onOpenDetails?: ((section: "outputs" | "sources") => void) | undefined;
}

export interface C0xSessionDetailsViewProps extends C0xSessionDataProps, C0xSessionOpenHandlers {}

const SUMMARY_OUTPUT_LIMIT = 6;
const SUMMARY_SOURCE_LIMIT = 3;

const DETAIL_ICONS: Record<SessionDetailIcon, LucideIcon> = {
  file: File,
  image: ImageIcon,
  unknown: FileQuestion,
  web: Globe2,
};

function useSessionDetails({
  activities,
  messages,
  thread,
}: C0xSessionDataProps): C0xSessionDetailsModel {
  return useMemo(
    () => deriveC0xSessionDetails({ activities, messages, thread }),
    [activities, messages, thread],
  );
}

function entryAction(
  entry: SessionDetailEntry,
  handlers: C0xSessionOpenHandlers,
): (() => void) | undefined {
  const target = entry.target;
  if (!target) return undefined;
  if (target.kind === "attachment" && handlers.onOpenAttachment) {
    return () => handlers.onOpenAttachment?.(target.attachment);
  }
  if (target.kind === "file" && handlers.onOpenFile) {
    return () => handlers.onOpenFile?.(target.path);
  }
  if (target.kind === "url" && handlers.onOpenUrl) {
    return () => handlers.onOpenUrl?.(target.url);
  }
  return undefined;
}

function EntryIcon({ icon }: { readonly icon: SessionDetailIcon }) {
  const Icon = DETAIL_ICONS[icon];
  return <Icon aria-hidden />;
}

function ActionableEntry({
  children,
  className,
  entry,
  handlers,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly entry: SessionDetailEntry;
  readonly handlers: C0xSessionOpenHandlers;
}) {
  const onClick = entryAction(entry, handlers);
  return onClick ? (
    <button
      type="button"
      className={className}
      aria-label={`Open ${entry.title}`}
      onClick={onClick}
    >
      {children}
    </button>
  ) : (
    <div className={className}>{children}</div>
  );
}

function CompactEntryRow({
  entry,
  handlers,
}: {
  readonly entry: SessionDetailEntry;
  readonly handlers: C0xSessionOpenHandlers;
}) {
  return (
    <ActionableEntry className="c0x-session-compact-row" entry={entry} handlers={handlers}>
      <span className="c0x-session-compact-icon">
        <EntryIcon icon={entry.icon} />
      </span>
      <span className="c0x-session-compact-title" title={entry.title}>
        {entry.title}
      </span>
    </ActionableEntry>
  );
}

function CompactSection({
  actionLabel,
  entries,
  emptyLabel,
  label,
  limit,
  onAdd,
  onOpenDetails,
  openDetailsLabel,
  handlers,
}: {
  readonly actionLabel: string;
  readonly emptyLabel: string;
  readonly entries: ReadonlyArray<SessionDetailEntry>;
  readonly handlers: C0xSessionOpenHandlers;
  readonly label: "Outputs" | "Sources";
  readonly limit: number;
  readonly onAdd?: (() => void) | undefined;
  readonly onOpenDetails?: (() => void) | undefined;
  readonly openDetailsLabel?: string | undefined;
}) {
  const visibleEntries = entries.slice(0, limit);
  return (
    <section className="c0x-session-compact-section" aria-labelledby={`c0x-session-${label}`}>
      <div className="c0x-session-section-heading">
        <h3 id={`c0x-session-${label}`}>{label}</h3>
        {onAdd ? (
          <Button variant="ghost-muted" size="icon-micro" aria-label={actionLabel} onClick={onAdd}>
            <Plus />
          </Button>
        ) : null}
      </div>
      {visibleEntries.length > 0 ? (
        <div className="c0x-session-compact-list">
          {visibleEntries.map((entry) => (
            <CompactEntryRow key={entry.id} entry={entry} handlers={handlers} />
          ))}
        </div>
      ) : (
        <p className="c0x-session-empty">{emptyLabel}</p>
      )}
      {onOpenDetails && openDetailsLabel ? (
        <button type="button" className="c0x-session-more" onClick={onOpenDetails}>
          {openDetailsLabel}
        </button>
      ) : null}
    </section>
  );
}

export function C0xSessionSummary({
  activities,
  messages,
  onAddOutput,
  onAddSource,
  onOpenAttachment,
  onOpenDetails,
  onOpenFile,
  onOpenUrl,
  thread,
}: C0xSessionSummaryProps) {
  const model = useSessionDetails({ activities, messages, thread });
  const handlers = { onOpenAttachment, onOpenFile, onOpenUrl };
  const hiddenOutputCount = Math.max(0, model.outputs.length - SUMMARY_OUTPUT_LIMIT);

  return (
    <aside className="c0x-session-summary" data-thread-id={thread.id} aria-label="Session summary">
      <CompactSection
        actionLabel="Add output"
        emptyLabel="No outputs recorded"
        entries={model.outputs}
        handlers={handlers}
        label="Outputs"
        limit={SUMMARY_OUTPUT_LIMIT}
        onAdd={onAddOutput}
        onOpenDetails={
          hiddenOutputCount > 0 && onOpenDetails ? () => onOpenDetails("outputs") : undefined
        }
        openDetailsLabel={hiddenOutputCount > 0 ? `Show ${hiddenOutputCount} more` : undefined}
      />
      <CompactSection
        actionLabel="Add source"
        emptyLabel="No sources recorded"
        entries={model.sources}
        handlers={handlers}
        label="Sources"
        limit={SUMMARY_SOURCE_LIMIT}
        onAdd={onAddSource}
        onOpenDetails={
          model.sources.length > 0 && onOpenDetails ? () => onOpenDetails("sources") : undefined
        }
        openDetailsLabel={model.sources.length > 0 ? "View all" : undefined}
      />
    </aside>
  );
}

function DetailEntryRow({
  entry,
  handlers,
}: {
  readonly entry: SessionDetailEntry;
  readonly handlers: C0xSessionOpenHandlers;
}) {
  return (
    <ActionableEntry className="c0x-session-detail-row" entry={entry} handlers={handlers}>
      <span className="c0x-session-detail-icon">
        <EntryIcon icon={entry.icon} />
      </span>
      <span className="c0x-session-detail-copy">
        <span className="c0x-session-detail-title">{entry.title}</span>
        <span className="c0x-session-detail-location">{entry.location}</span>
        <span className="c0x-session-detail-provenance">
          {sessionDetailProvenanceLabel(entry.provenance)}
        </span>
      </span>
    </ActionableEntry>
  );
}

function DetailSection({
  entries,
  handlers,
  label,
}: {
  readonly entries: ReadonlyArray<SessionDetailEntry>;
  readonly handlers: C0xSessionOpenHandlers;
  readonly label: string;
}) {
  return (
    <section className="c0x-session-detail-section" aria-labelledby={`c0x-session-detail-${label}`}>
      <h3 id={`c0x-session-detail-${label}`}>{label}</h3>
      {entries.length > 0 ? (
        <div className="c0x-session-detail-list">
          {entries.map((entry) => (
            <DetailEntryRow key={entry.id} entry={entry} handlers={handlers} />
          ))}
        </div>
      ) : (
        <p className="c0x-session-detail-empty">No {label.toLowerCase()} recorded</p>
      )}
    </section>
  );
}

function ToolUsage({ model }: { readonly model: C0xSessionDetailsModel }) {
  return (
    <section className="c0x-session-tool-usage" aria-labelledby="c0x-session-tool-usage">
      <h3 id="c0x-session-tool-usage">Tool usage</h3>
      {model.toolUsage.length > 0 ? (
        <div className="c0x-session-tool-groups">
          {model.toolUsage.map((group) => (
            <div className="c0x-session-tool-group" key={group.provider}>
              <div className="c0x-session-tool-provider">
                <span>{group.provider}</span>
                <span>{group.count === 1 ? "1 call" : `${group.count} calls`}</span>
              </div>
              {group.tools.map((entry) => (
                <div className="c0x-session-tool-row" key={entry.tool}>
                  <Wrench aria-hidden />
                  <span>{entry.tool}</span>
                  <span>{entry.count}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="c0x-session-detail-empty">No tool calls recorded</p>
      )}
    </section>
  );
}

export function C0xSessionDetailsView({
  activities,
  messages,
  onOpenAttachment,
  onOpenFile,
  onOpenUrl,
  thread,
}: C0xSessionDetailsViewProps) {
  const model = useSessionDetails({ activities, messages, thread });
  const handlers = { onOpenAttachment, onOpenFile, onOpenUrl };
  return (
    <div className="c0x-session-details" data-thread-id={thread.id}>
      <header className="c0x-session-details-header">
        <h2>Sources &amp; outputs</h2>
      </header>
      <ScrollArea className="c0x-session-details-scroll" scrollbarGutter>
        <div className="c0x-session-details-content">
          <DetailSection label="Sources" entries={model.sources} handlers={handlers} />
          <DetailSection label="Outputs" entries={model.outputs} handlers={handlers} />
          <ToolUsage model={model} />
        </div>
      </ScrollArea>
    </div>
  );
}
