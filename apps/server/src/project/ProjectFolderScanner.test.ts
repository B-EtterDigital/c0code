// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, it, expect } from "vite-plus/test";
import { scanProjectFolders } from "./ProjectFolderScanner.ts";

describe("development folder discovery", () => {
  it("stays within the chosen depth, excludes dependencies and symlinks, and stops at a project root", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "c0code-projects-"));
    try {
      for (const directory of [
        "dev/app/.git",
        "dev/app/packages/nested/.git",
        "dev/group/tool/.git",
        "dev/group/deep/hidden/.git",
        "dev/node_modules/library/.git",
        "outside/.git",
      ])
        await NodeFSP.mkdir(NodePath.join(root, directory), { recursive: true });
      await NodeFSP.symlink(NodePath.join(root, "outside"), NodePath.join(root, "dev", "external"));
      const result = await scanProjectFolders({ roots: [NodePath.join(root, "dev")], depth: 2 });
      expect(result.candidates.map((item) => NodePath.relative(root, item.path))).toEqual([
        "dev/app",
        "dev/group/tool",
      ]);
      expect(result.truncated).toBe(false);
      expect(
        (await scanProjectFolders({ roots: [NodePath.join(root, "dev")], depth: 1 })).candidates,
      ).toHaveLength(1);
      await NodeFSP.symlink(NodePath.join(root, "dev"), NodePath.join(root, "chosen-alias"));
      const throughAlias = await scanProjectFolders({
        roots: [NodePath.join(root, "chosen-alias")],
        depth: 2,
      });
      expect(throughAlias.candidates.map((item) => NodePath.relative(root, item.path))).toEqual([
        "chosen-alias/app",
        "chosen-alias/group/tool",
      ]);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
  it("finds a new project without agent history and returns no suggestions without a chosen root", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "c0code-new-project-"));
    try {
      await NodeFSP.writeFile(NodePath.join(root, "pyproject.toml"), "[project]\nname='new'");
      const result = await scanProjectFolders({ roots: [root] });
      expect(result.candidates[0]).toMatchObject({ path: root, sources: [], threadCount: 0 });
      expect((await scanProjectFolders({ roots: [] })).candidates).toEqual([]);
      await expect(scanProjectFolders({ roots: ["relative"] })).rejects.toThrow("absolute");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
