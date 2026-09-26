import type {
  AgentSessionProjectCandidate,
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  CopyIcon,
  LinkIcon,
  MonitorIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  groupOnboardingProjects,
  partitionOnboardingProjects,
  onboardingProjectKey,
  resolveOnboardingLandingProject,
  resolveOnboardingProjectId,
  type OnboardingProjectGroup,
} from "../../onboarding/projectImport.logic";
import { ClaudeAI, OpenAI } from "../Icons";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { formatRelativeTime } from "../../timestampFormat";
import { OnboardingProjectLogoPicker } from "./OnboardingProjectLogoPicker";

export type ImportCandidate = AgentSessionProjectCandidate & {
  readonly environmentId: EnvironmentId;
  readonly key: string;
};

/**
 * Repositories first, newest activity on top. Clones of one repository share
 * a group with a tri-state checkbox. Folders that are not git repositories
 * sit collapsed at the bottom so they stay reachable without adding noise.
 * Source icons appear only on repository rows so the columns stay still.
 */
export function ImportCandidateList({
  candidates,
  selectedKeys,
  onSelectionChange,
}: {
  readonly candidates: ReadonlyArray<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onSelectionChange: (next: ReadonlySet<string>) => void;
}) {
  const { repositories, other } = useMemo(() => groupOnboardingProjects(candidates), [candidates]);
  const setKeys = (keys: ReadonlyArray<string>, checked: boolean) => {
    const next = new Set(selectedKeys);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    onSelectionChange(next);
  };

  return (
    <>
      {repositories.map((group) => (
        <ImportRepositoryGroup
          key={group.key}
          group={group}
          selectedKeys={selectedKeys}
          onToggle={setKeys}
        />
      ))}
      {other.map((candidate) => (
        <ImportCandidateRow
          key={candidate.key}
          candidate={candidate}
          label={candidate.title}
          checked={selectedKeys.has(candidate.key)}
          onCheckedChange={(checked) => setKeys([candidate.key], checked)}
        />
      ))}
    </>
  );
}

function ImportRepositoryGroup({
  group,
  selectedKeys,
  onToggle,
}: {
  readonly group: OnboardingProjectGroup<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggle: (keys: ReadonlyArray<string>, checked: boolean) => void;
}) {
  const keys = group.candidates.map((candidate) => candidate.key);
  const selectedCount = keys.filter((key) => selectedKeys.has(key)).length;
  const single = group.candidates.length === 1;
  const only = group.candidates[0];
  if (single && only !== undefined) {
    return (
      <ImportCandidateRow
        candidate={only}
        label={group.label}
        {...(group.repository === null ? {} : { secondary: only.path })}
        checked={selectedKeys.has(only.key)}
        onCheckedChange={(checked) => onToggle([only.key], checked)}
      />
    );
  }
  return (
    <Collapsible defaultOpen>
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
        <Checkbox
          checked={selectedCount === keys.length}
          indeterminate={selectedCount > 0 && selectedCount < keys.length}
          onCheckedChange={(checked) => onToggle(keys, checked === true)}
        />
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
          <span className="truncate text-sm font-medium">{group.label}</span>
          <ImportRowMeta
            sources={[...new Set(group.candidates.flatMap((c) => c.sources))]}
            threadCount={group.threadCount}
            lastActiveAt={group.lastActiveAt}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        {group.candidates.map((candidate) => (
          <ImportCandidateRow
            key={candidate.key}
            candidate={candidate}
            label={candidate.path}
            nested
            checked={selectedKeys.has(candidate.key)}
            onCheckedChange={(checked) => onToggle([candidate.key], checked)}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ImportCandidateRow({
  candidate,
  label,
  secondary,
  nested = false,
  checked,
  onCheckedChange,
}: {
  readonly candidate: ImportCandidate;
  readonly label: string;
  readonly secondary?: string;
  readonly nested?: boolean;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 has-disabled:cursor-default",
          nested && "pl-8",
        )}
      >
        <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
        <Tooltip>
          <TooltipTrigger
            render={<span className="flex min-w-0 flex-1 items-baseline gap-2 truncate" />}
          >
            <span className={cn("truncate", nested ? "font-mono text-xs" : "text-sm font-medium")}>
              {label}
            </span>
            {secondary !== undefined ? (
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {secondary}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipPopup className="max-w-96 break-all font-mono">{candidate.path}</TooltipPopup>
        </Tooltip>
        <ImportRowMeta
          sources={nested ? null : candidate.sources}
          threadCount={candidate.threadCount}
          lastActiveAt={candidate.lastActiveAt}
        />
      </label>
      {checked ? <OnboardingProjectLogoPicker candidate={candidate} /> : null}
    </div>
  );
}

/**
 * Trailing columns shared by every import row: source icons, thread count,
 * last activity. Each column has a fixed width and each icon has its own slot
 * so nothing shifts between rows that differ in sources or digit count.
 */
function ImportRowMeta({
  sources,
  threadCount,
  lastActiveAt,
}: {
  readonly sources: ReadonlyArray<"claudeAgent" | "codex" | "opencode"> | null;
  readonly threadCount: number;
  readonly lastActiveAt: string | null;
}) {
  const relative = lastActiveAt === null ? null : formatRelativeTime(lastActiveAt);
  // "just now" does not fit the fixed column, so collapse it.
  const age = relative === null ? "" : relative.suffix === null ? "now" : relative.value;
  return (
    <span className="ml-auto grid shrink-0 grid-cols-[1rem_1rem_2.5rem_2.25rem] items-center gap-x-1 text-xs text-muted-foreground tabular-nums">
      <span className="flex size-4 items-center justify-center">
        {sources?.includes("claudeAgent") ? (
          <ClaudeAI className="size-3" aria-label="Claude Code" />
        ) : null}
      </span>
      <span className="flex size-4 items-center justify-center">
        {sources?.includes("codex") ? <OpenAI className="size-3" aria-label="Codex" /> : null}
      </span>
      <span className="text-right">{threadCount}</span>
      <span className="text-right whitespace-nowrap">{age}</span>
    </span>
  );
}

// ── Shared bits ──────────────────────────────────────────────
