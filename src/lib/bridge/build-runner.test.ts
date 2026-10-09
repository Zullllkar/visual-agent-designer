import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/project/schema";
import { prepareBuild, startBuild } from "./build-runner";

function project(): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "Demo",
    rawIdea: "idea",
    createdAt: "",
    updatedAt: "",
    pages: [],
  } as ProjectFile;
}

describe("prepareBuild / startBuild guards", () => {
  it("refuses when the project has no linked repo", () => {
    const result = prepareBuild({
      project: project(),
      slug: "cursor",
      bridgeUrl: "http://127.0.0.1:3000/mcp",
      bridgeToken: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no_linked_repo");
  });

  it("startBuild requires an explicit confirm flag", async () => {
    const result = await startBuild({
      project: project(),
      slug: "cursor",
      fingerprint: "deadbeef",
      confirm: false,
      bridgeUrl: "http://127.0.0.1:3000/mcp",
      bridgeToken: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("confirm_required");
  });
});
