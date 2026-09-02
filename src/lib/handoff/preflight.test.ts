import { describe, expect, it } from "vitest";

import { buildHandoffPreflight } from "./preflight";
import type { ProjectFile } from "@/lib/project/schema";

describe("buildHandoffPreflight", () => {
  it("blocks handoff export when no final image assets exist", () => {
    const result = buildHandoffPreflight(makeProject({ assets: [] }));

    expect(result.ok).toBe(false);
    expect(result.blockedCount).toBe(1);
    expect(result.checks.find((check) => check.id === "final-assets")).toMatchObject({
      level: "error",
    });
  });

  it("allows handoff export and warns when final assets are remote URLs", () => {
    const result = buildHandoffPreflight(
      makeProject({
        assets: [
          {
            id: "asset-1",
            prompt: "home app UI",
            src: "https://example.com/app-home.png",
            width: 1280,
            height: 720,
            model: "test",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "candidate",
          },
        ],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.finalAssetCount).toBe(1);
    expect(result.warningCount).toBeGreaterThan(0);
    expect(result.checks.find((check) => check.id === "embedded-assets")).toMatchObject({
      level: "warning",
    });
  });

  it("respects selectedAssetIds when scoping final assets", () => {
    const project = makeProject({
      assets: [
        {
          id: "keep",
          prompt: "final",
          src: "data:image/png;base64,aaa",
          width: 100,
          height: 100,
          model: "test",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "starred",
        },
        {
          id: "skip",
          prompt: "explore",
          src: "data:image/png;base64,bbb",
          width: 100,
          height: 100,
          model: "test",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "candidate",
        },
      ],
    });

    const empty = buildHandoffPreflight(project, { selectedAssetIds: [] });
    expect(empty.ok).toBe(false);
    expect(empty.finalAssetCount).toBe(0);

    const one = buildHandoffPreflight(project, { selectedAssetIds: ["keep"] });
    expect(one.ok).toBe(true);
    expect(one.finalAssetCount).toBe(1);
  });

  it("warns when selected assets lack design specs", () => {
    const result = buildHandoffPreflight(
      makeProject({
        assets: [
          {
            id: "keep",
            prompt: "final",
            src: "data:image/png;base64,aaa",
            width: 100,
            height: 100,
            model: "test",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "starred",
          },
        ],
      }),
      { selectedAssetIds: ["keep"], selectedReferenceIds: [] }
    );

    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.id === "design-specs")).toMatchObject({
      level: "warning",
    });
    expect(result.checks.find((c) => c.id === "delivery-scope")).toMatchObject({
      level: "ok",
    });
  });

  it("scopes reference count by selectedReferenceIds", () => {
    const result = buildHandoffPreflight(
      makeProject({
        assets: [
          {
            id: "keep",
            prompt: "final",
            src: "data:image/png;base64,aaa",
            width: 100,
            height: 100,
            model: "test",
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "starred",
          },
        ],
        references: [
          {
            id: "r1",
            label: "ref1",
            src: "data:image/png;base64,r1",
            width: 10,
            height: 10,
            source: "upload",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "r2",
            label: "ref2",
            src: "data:image/png;base64,r2",
            width: 10,
            height: 10,
            source: "upload",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
      { selectedAssetIds: ["keep"], selectedReferenceIds: ["r1"] }
    );

    expect(result.referenceCount).toBe(1);
  });
});

function makeProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "project-1",
    slug: "project-1",
    title: "Test Project",
    rawIdea: "Build a learning app",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    ...overrides,
  };
}
