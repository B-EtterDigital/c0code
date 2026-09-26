import { expect, test } from "vite-plus/test";
import { projectActivityIds } from "./projectActivity";

test("promoted drafts follow the actual thread on its chosen computer", () => {
  expect(
    projectActivityIds(
      { id: "live", environmentId: "remote" },
      {
        stable: {
          threadId: "old",
          environmentId: "local",
          promotedTo: { threadId: "live", environmentId: "remote" },
        },
        unrelated: { threadId: "live", environmentId: "other" },
      },
    ),
  ).toEqual(["live", "draft:stable"]);
});

test("unpromoted drafts only report their matching thread", () => {
  expect(
    projectActivityIds(
      { id: "live", environmentId: "local" },
      {
        matching: { threadId: "live", environmentId: "local" },
        unrelated: { threadId: "other", environmentId: "local" },
      },
    ),
  ).toEqual(["live", "draft:matching"]);
});
