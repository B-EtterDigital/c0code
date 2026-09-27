import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { projectC0xSidebarCatalog } from "./sidebarCatalog";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const now = "2026-09-27T14:00:00.000Z";
const thread = {
  id: ThreadId.make("conversation"),
  environmentId: local,
  projectId,
  title: "Existing conversation",
  branch: "feature",
  updatedAt: now,
  archivedAt: null,
  latestUserMessageAt: now,
  session: null,
};

describe("native sidebar catalog", () => {
  it("keeps same-id projects on different computers separate and publishes all conversations", () => {
    const rows = projectC0xSidebarCatalog(
      [thread, { ...thread, environmentId: remote }],
      [
        { id: projectId, environmentId: local, title: "Local project", workspaceRoot: "/local" },
        { id: projectId, environmentId: remote, title: "Remote project", workspaceRoot: "/remote" },
      ],
    );
    expect(rows.map(({ href, projectName }) => ({ href, projectName }))).toEqual([
      { href: "/local/conversation", projectName: "Local project" },
      { href: "/remote/conversation", projectName: "Remote project" },
    ]);
    expect(rows[1]).toMatchObject({
      title: "Existing conversation",
      branch: "feature",
      updatedAt: now,
      kind: "thread",
    });
  });

  it("excludes empty drafts and archives without dropping a conversation whose project is still loading", () => {
    const rows = projectC0xSidebarCatalog(
      [
        thread,
        { ...thread, id: ThreadId.make("empty"), latestUserMessageAt: null },
        { ...thread, id: ThreadId.make("archived"), archivedAt: now },
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "conversation", projectName: null });
  });
});
