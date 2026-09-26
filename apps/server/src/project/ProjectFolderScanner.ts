// Pure Node filesystem boundary: Dirent avoids following child symlinks; console errors use the C0VIBE SRS relay.
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import type {
  AgentSessionProjectCandidate,
  AgentSessionScanInput,
  AgentSessionScanResult,
} from "@t3tools/contracts";

const EXCLUDED = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  "coverage",
  "__pycache__",
]);
const MARKERS = new Set([
  ".git",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "pom.xml",
  "composer.json",
  "Gemfile",
  "CMakeLists.txt",
]);

/** Bounded discovery beneath explicitly chosen folders. Never follows child symlinks. */
export async function scanProjectFolders(
  input: AgentSessionScanInput,
  history: readonly AgentSessionProjectCandidate[] = [],
): Promise<AgentSessionScanResult> {
  const roots = input.roots ?? [];
  if (roots.length > 8) throw new Error("Choose up to eight development folders at a time.");
  const depth = input.depth ?? 2;
  const candidates = new Map<string, AgentSessionProjectCandidate>();
  const visited = new Set<string>();
  let truncated = false;
  for (const requested of roots) {
    const expanded =
      requested === "~"
        ? NodeOS.homedir()
        : requested.startsWith("~/")
          ? NodePath.join(NodeOS.homedir(), requested.slice(2))
          : requested;
    if (!NodePath.isAbsolute(expanded))
      throw new Error("Choose an absolute development folder path.");
    // Preserve the folder path the user chose, including an explicitly selected
    // symlink. The client scopes results to that path; child symlinks stay excluded.
    const root = NodePath.resolve(expanded);
    if (!(await NodeFSP.stat(root)).isDirectory()) throw new Error("Choose a folder, not a file.");
    const queue = [{ directory: root, level: 0 }];
    while (queue.length) {
      const item = queue.shift()!;
      if (visited.has(item.directory)) continue;
      if (visited.size >= 1000) {
        truncated = true;
        break;
      }
      visited.add(item.directory);
      let entries;
      try {
        entries = await NodeFSP.readdir(item.directory, { withFileTypes: true });
      } catch (error) {
        console.error(
          "[c0x-t3-error] onboarding.projectFolder.read",
          item.directory,
          String(error),
        );
        if (item.level === 0) throw error;
        truncated = true;
        continue;
      }
      const names = new Set(entries.map((entry) => entry.name));
      const isProject = [...MARKERS].some((marker) => names.has(marker));
      if (isProject) {
        const prior = history.find(
          (candidate) => NodePath.resolve(candidate.path) === item.directory,
        );
        candidates.set(
          item.directory,
          prior ?? {
            path: item.directory,
            title: NodePath.basename(item.directory) || item.directory,
            sources: [],
            threadCount: 0,
            lastActiveAt: null,
            alreadyImported: false,
            git: names.has(".git") ? { remoteKey: null, repository: null } : null,
          },
        );
        // A repository is one project. Its packages and generated folders aren't suggestions.
        continue;
      }
      if (item.level >= depth) continue;
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || EXCLUDED.has(entry.name))
          continue;
        if (queue.length + visited.size >= 1000) {
          truncated = true;
          break;
        }
        queue.push({ directory: NodePath.join(item.directory, entry.name), level: item.level + 1 });
      }
    }
  }
  return {
    candidates: [...candidates.values()].sort((a, b) => a.path.localeCompare(b.path)),
    scannedAt: new Date().toISOString(),
    truncated,
  };
}
