import { describe, expect, it } from "vitest";
import { createProjectFixture } from "@/lib/agents/test-fixtures";
import { contextSourcesForPrompt, listContextSources, updateContextSource } from "./context-sources";

describe("context source preferences", () => {
  it("provides all sources enabled by default", () => {
    const project = createProjectFixture();
    expect(listContextSources(project)).toHaveLength(7);
    expect(contextSourcesForPrompt(project).every((source) => source.enabled)).toBe(true);
  });
  it("persists user controlled enablement and priority", () => {
    const project = createProjectFixture();
    const next = updateContextSource(project, "context-references", { enabled: false, priority: 0 });
    expect(contextSourcesForPrompt(next).some((source) => source.id === "context-references")).toBe(false);
    expect(listContextSources(next)[0]?.id).toBe("context-references");
  });
});
