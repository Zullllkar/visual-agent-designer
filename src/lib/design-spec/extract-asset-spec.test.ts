import { describe, expect, it } from "vitest";
import { normalizeRegionBBox } from "./extract-asset-spec";
import {
  buildHeuristicSpec,
  mergeSpecTokensIntoHandoffTokens,
  renderAssetDesignSpecMarkdown,
} from "./spec-format";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";

function makeProject(): ProjectFile {
  return {
    id: "p1",
    title: "Demo App",
    slug: "demo",
    rawIdea: "A calm productivity app",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    brief: {
      productName: "Demo App",
      positioning: "Calm productivity",
      targetUser: "Indie makers",
      platform: "web",
      visualStyle: "Minimal slate UI with accent #5E6AD2",
      coreFeatures: ["Inbox", "Focus mode"],
      scenarios: ["Morning planning"],
      outputTargets: ["cursor", "markdown"],
    },
  };
}

function makeAsset(): ImageAsset {
  return {
    id: "asset-1",
    prompt: "Mobile app home dashboard with sidebar metrics #0A0E1A",
    src: "data:image/png;base64,xx",
    width: 1024,
    height: 1024,
    model: "mock",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "candidate",
  };
}

describe("normalizeRegionBBox", () => {
  it("keeps 0-1 normalized coords", () => {
    expect(
      normalizeRegionBBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { width: 1440, height: 3200 })
    ).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it("converts pixel coords using image dimensions", () => {
    expect(
      normalizeRegionBBox({ x: 720, y: 640, w: 400, h: 300 }, { width: 1440, height: 3200 })
    ).toEqual({ x: 0.5, y: 0.2, w: 400 / 1440, h: 300 / 3200 });
  });

  it("rejects tiny boxes", () => {
    expect(
      normalizeRegionBBox({ x: 0, y: 0, w: 0.01, h: 0.5 }, { width: 1000, height: 1000 })
    ).toBeUndefined();
  });
});

describe("design-spec extract helpers", () => {
  it("builds a heuristic spec with tokens from prompt hex", () => {
    const spec = buildHeuristicSpec(makeAsset(), makeProject());
    expect(spec.version).toBe(1);
    expect(spec.source).toBe("heuristic");
    expect(spec.extractionWarnings?.length).toBeGreaterThan(0);
    expect(spec.tokens.colors.some((c) => /#/i.test(c.value))).toBe(true);
    expect(spec.regions.length).toBeGreaterThan(0);
  });

  it("builds asset-library heuristic regions from prompt", () => {
    const spec = buildHeuristicSpec(
      { ...makeAsset(), prompt: "黑核素材库 landing with weapon grid" },
      makeProject()
    );
    expect(spec.regions.some((r) => r.delivery === "media")).toBe(true);
    expect(spec.regions.filter((r) => r.delivery === "code").length).toBeGreaterThan(
      0
    );
  });

  it("renders markdown with regions and tokens", () => {
    const spec = buildHeuristicSpec(makeAsset(), makeProject());
    const md = renderAssetDesignSpecMarkdown(spec, {
      file: "assets/final/a.png",
    });
    expect(md).toContain("# Design Spec");
    expect(md).toContain("## Regions");
  });

  it("merges spec colors into handoff tokens", () => {
    const spec = buildHeuristicSpec(makeAsset(), makeProject());
    const merged = mergeSpecTokensIntoHandoffTokens(
      { color: ["#fff"], fontSize: [14], radius: [8] },
      [spec]
    );
    expect(merged.color).toContain("#fff");
  });
});
