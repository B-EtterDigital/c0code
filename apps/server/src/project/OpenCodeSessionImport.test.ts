import { describe, expect, it } from "@effect/vitest";
import { parseOpenCodeImport } from "./OpenCodeSessionImport.ts";

const exported = { info: { id: "ses_test", directory: "/repo", title: "Saved work", time: { created: 1000, updated: 2000 } }, messages: [
  { info: { role: "user", time: { created: 1000 }, model: { providerID: "openrouter", modelID: "google/gemini-2.5-pro" } }, parts: [{ type: "text", text: "Original request" }] },
  { info: { role: "assistant", time: { created: 2000 }, providerID: "openrouter", modelID: "google/gemini-2.5-pro" }, parts: [{ type: "text", text: "Saved answer" }] },
] };
describe("OpenCode native import", () => {
  it("retains native session identity, the full OpenRouter route and both sides of the conversation", () => {
    expect(parseOpenCodeImport(exported, "ses_test", "/repo")).toMatchObject({ _tag: "Importable", thread: {
      providerInstanceId: "opencode", providerSessionId: "ses_test", source: "opencode", model: "openrouter/google/gemini-2.5-pro",
      messages: [{ role: "user", text: "Original request" }, { role: "assistant", text: "Saved answer" }],
    } });
  });
  it("rejects a different session, a different project and empty history", () => {
    expect(() => parseOpenCodeImport(exported, "ses_other", "/repo")).toThrow("does not belong");
    expect(() => parseOpenCodeImport(exported, "ses_test", "/other")).toThrow("does not belong");
    expect(() => parseOpenCodeImport({ ...exported, messages: [] }, "ses_test", "/repo")).toThrow("no conversation");
  });
});
