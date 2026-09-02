import { describe, expect, it } from "vitest";
import { discardAssetsInProject } from "./discard-assets";
import type { ProjectFile } from "./schema";

describe("discardAssetsInProject", () => {
  it("marks matching assets as discarded without removing them", () => {
    const project = makeProject([
      { id: "a1", status: "failed" as const },
      { id: "a2", status: "generating" as const },
    ]);
    const next = discardAssetsInProject(project, ["a1"]);
    expect(next.assets).toHaveLength(2);
    expect(next.assets?.[0]).toMatchObject({ id: "a1", status: "discarded" });
    expect(next.assets?.[1]).toMatchObject({ id: "a2", status: "generating" });
  });

  it("is a no-op when already discarded", () => {
    const project = makeProject([{ id: "a1", status: "discarded" as const }]);
    const next = discardAssetsInProject(project, ["a1"]);
    expect(next).toBe(project);
  });
});

function makeProject(
  assets: Array<{ id: string; status: "failed" | "generating" | "discarded" }>
): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "Demo",
    rawIdea: "x",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    assets: assets.map((a) => ({
      id: a.id,
      prompt: "p",
      src: "",
      width: 100,
      height: 100,
      model: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: a.status,
    })),
  };
}
