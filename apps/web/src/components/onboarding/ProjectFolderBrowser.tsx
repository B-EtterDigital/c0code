import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/** Uses the selected computer's real filesystem, including remote computers. */
export function ProjectFolderBrowser({ environmentId, disabled, onSelect, label = "Browse project", confirmLabel = "Add this project" }: {
  environmentId: EnvironmentId;
  disabled: boolean;
  onSelect: (path: string) => void;
  label?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [path, setPath] = useState("~/");
  const [queryPath, setQueryPath] = useState("~/");
  const query = useEnvironmentQuery(open ? filesystemEnvironment.browse({
    environmentId, input: { partialPath: queryPath },
  }) : null);
  useEffect(() => {
    if (query.error) console.error("[c0x-t3-error] onboarding.browseFolders", query.error);
  }, [query.error]);
  const browse = (next: string) => {
    const value = next.trim();
    if (!value) return;
    const directory = /[\\/]$/.test(value) ? value : `${value}/`;
    setPath(directory);
    setQueryPath(directory);
  };
  const current = query.data?.parentPath;
  const entries = query.data?.entries.filter((entry) => showHidden || !entry.name.startsWith(".")) ?? [];
  const parent = current && /^[A-Za-z]:[\\/]?$/.test(current) ? current : current?.replace(/[\\/]+$/, "").replace(/[^\\/]+$/, "") || "/";

  return <div className="my-3">
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(!open)}>
      <FolderIcon className="size-4" />{open ? "Close folder browser" : label}
    </Button>
    {open ? <div className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3" aria-label="Project folder browser">
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" aria-label="Parent folder" disabled={disabled || query.isPending || !current || current === parent} onClick={() => browse(parent)}><ArrowUpIcon className="size-4" /></Button>
        <Input aria-label="Folder path" value={path} disabled={disabled} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); browse(path); }
        }} />
        <Button size="sm" variant="outline" disabled={disabled || !path.trim()} onClick={() => browse(path)}>Go</Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />Show hidden folders</label>
      {query.error ? <p role="alert" className="text-sm text-destructive">{query.error} <Button size="xs" variant="ghost" onClick={query.refresh}>Retry</Button></p> : null}
      {query.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading folders…</p> : <div className="max-h-40 overflow-y-auto">
        {entries.map((entry) => <Button key={entry.fullPath} variant="ghost" className="w-full justify-start" disabled={disabled} onClick={() => browse(entry.fullPath)}><FolderIcon className="size-4" /><span className="truncate">{entry.name}</span></Button>)}
        {entries.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No subfolders</p> : null}
      </div>}
      <Button size="sm" disabled={disabled || query.isPending || !!query.error || !current} onClick={() => {
        if (current) { onSelect(current); setOpen(false); }
      }}>{confirmLabel}</Button>
    </div> : null}
  </div>;
}
