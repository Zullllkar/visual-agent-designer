import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { diffDesignSnapshots, hashSrc, takeDesignSnapshot } from "./design-snapshot";
import type { LayoutIR, LayoutNode } from "./layout-ir";

function asset(id: string, extra: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id,
    prompt: `mockup ${id}`,
    src: `data:image/png;base64,${id}AAAA`,
    width: 1440,
    height: 900,
    model: "m",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "candidate",
    ...extra,
  };
}

const heroNode = (
  over: Partial<Extract<LayoutNode, { rebuildInCode: false }>> = {},
): LayoutNode => ({
  id: "hero",
  parentAssetId: "s1",
  role: "hero",
  bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.4 },
  rebuildInCode: false,
  prompt: "hero art",
  status: "ready",
  materialAssetId: "mat-hero",
  media: "assets/materials/s1/hero.png",
  swatch: { dominant: "#181820", accent: "#7C3AED" },
  ...over,
});

const ctaNode = (over: Partial<Extract<LayoutNode, { rebuildInCode: true }>> = {}): LayoutNode => ({
  id: "cta",
  role: "cta",
  bbox: { x: 0.4, y: 0.55, w: 0.2, h: 0.06 },
  rebuildInCode: true,
  copy: "Start free",
  copySource: "plan",
  media: null,
  ...over,
});

function layout(nodes: LayoutNode[]): LayoutIR {
  return {
    version: 1,
    mockupAssetId: "s1",
    width: 1440,
    height: 900,
    referenceImage: "x.png",
    nodes,
  };
}

function project(
  assets: ImageAsset[],
  layouts: Record<string, LayoutIR> = {},
  updatedAt = "2026-01-01T00:00:00.000Z",
): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "Acme",
    rawIdea: "idea",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    pages: [],
    assets,
    materializations: Object.fromEntries(
      Object.entries(layouts).map(([id, l]) => [
        id,
        { mockupAssetId: id, layout: l, createdAt: updatedAt, updatedAt },
      ]),
    ),
  } as ProjectFile;
}

describe("takeDesignSnapshot", () => {
  it("is content-addressed: same design → same hash, regardless of time", () => {
    const p = project([asset("s1")], { s1: layout([heroNode(), ctaNode()]) });
    const a = takeDesignSnapshot(p, new Date("2026-03-01T00:00:00Z"));
    const b = takeDesignSnapshot(p, new Date("2026-03-02T00:00:00Z"));
    expect(a.hash).toBe(b.hash);
    expect(a.takenAt).not.toBe(b.takenAt);
    expect(Object.keys(a.screens)).toEqual(["s1"]);
    expect(a.screens.s1.nodes.hero.media).toBe("assets/materials/s1/hero.png");
    expect(a.screens.s1.nodes.cta.copy).toBe("Start free");
  });

  it("ignores materialized children and discarded assets", () => {
    const p = project([
      asset("s1"),
      asset("mat-hero", { source: "materialized", parentAssetId: "s1" }),
      asset("gone", { status: "discarded" }),
    ]);
    expect(Object.keys(takeDesignSnapshot(p).screens)).toEqual(["s1"]);
  });
});

describe("diffDesignSnapshots", () => {
  const base = project([asset("s1"), asset("s2", { prompt: "settings screen" })], {
    s1: layout([heroNode(), ctaNode()]),
  });
  const before = takeDesignSnapshot(base, new Date("2026-03-01T00:00:00Z"));

  it("reports nothing when nothing changed", () => {
    const after = takeDesignSnapshot(base, new Date("2026-03-02T00:00:00Z"));
    const d = diffDesignSnapshots(before, after);
    expect(d.changedScreens).toEqual([]);
    expect(d.unchangedScreens.sort()).toEqual(["s1", "s2"]);
    expect(d.summary).toEqual(["No design changes since the baseline."]);
  });

  it("classifies copy edits as copy-only and material regeneration as restyle", () => {
    const mat = asset("mat-hero", {
      source: "materialized",
      parentAssetId: "s1",
      src: "data:image/png;base64,NEWMATERIAL",
    });
    const next = project([asset("s1"), asset("s2", { prompt: "settings screen" }), mat], {
      s1: layout([heroNode(), ctaNode({ copy: "Start for free" })]),
    });
    // 基线里 material 资产不存在 → materialSrcHash 从无到有，算 restyle；copy 变化算 copy-only；restyle 优先
    const d = diffDesignSnapshots(before, takeDesignSnapshot(next));
    expect(d.changedScreens).toHaveLength(1);
    const s1 = d.changedScreens[0];
    expect(s1.impact).toBe("restyle");
    expect(s1.changes.map((c) => c.kind).sort()).toEqual(["copy", "material-regenerated"]);
    const copy = s1.changes.find((c) => c.kind === "copy");
    expect(copy).toMatchObject({ nodeId: "cta", before: "Start free", after: "Start for free" });
  });

  it("detects moved / resized / added / removed regions as relayout", () => {
    const next = project([asset("s1"), asset("s2", { prompt: "settings screen" })], {
      s1: layout([
        heroNode({ bbox: { x: 0.05, y: 0.3, w: 0.9, h: 0.4 } }),
        {
          id: "nav",
          role: "nav",
          bbox: { x: 0, y: 0, w: 1, h: 0.08 },
          rebuildInCode: true,
          copy: "Home · Pricing",
          media: null,
        },
      ]),
    });
    const d = diffDesignSnapshots(before, takeDesignSnapshot(next));
    const s1 = d.changedScreens[0];
    expect(s1.impact).toBe("relayout");
    expect(s1.changes.map((c) => c.kind).sort()).toEqual([
      "node-added",
      "node-moved",
      "node-removed",
    ]);
    expect(s1.changes.find((c) => c.kind === "node-removed")?.nodeId).toBe("cta");
    expect(s1.changes.find((c) => c.kind === "node-added")?.nodeId).toBe("nav");
  });

  it("treats a regenerated mockup image as rebuild and tracks screen add/remove", () => {
    const next = project(
      [
        asset("s1", { src: "data:image/png;base64,TOTALLY-DIFFERENT" }),
        asset("s3", { prompt: "new onboarding" }),
      ],
      {
        s1: layout([heroNode(), ctaNode()]),
      },
    );
    const d = diffDesignSnapshots(before, takeDesignSnapshot(next));
    expect(d.changedScreens[0]).toMatchObject({ assetId: "s1", impact: "rebuild" });
    expect(d.changedScreens[0].changes[0].kind).toBe("image-regenerated");
    expect(d.addedScreens.map((s) => s.assetId)).toEqual(["s3"]);
    expect(d.removedScreens.map((s) => s.assetId)).toEqual(["s2"]);
    expect(d.summary.join("\n")).toMatch(/1 new screen/);
    expect(d.summary.join("\n")).toMatch(/1 screen\(s\) removed/);
  });

  it("ignores sub-2% bbox jitter from re-running vision", () => {
    const next = project([asset("s1"), asset("s2", { prompt: "settings screen" })], {
      s1: layout([heroNode({ bbox: { x: 0.06, y: 0.11, w: 0.89, h: 0.41 } }), ctaNode()]),
    });
    const d = diffDesignSnapshots(before, takeDesignSnapshot(next));
    expect(d.changedScreens).toEqual([]);
  });
});

describe("hashSrc", () => {
  it("changes when the image bytes change and is stable otherwise", () => {
    const a = hashSrc("data:image/png;base64,AAAA");
    expect(hashSrc("data:image/png;base64,AAAA")).toBe(a);
    expect(hashSrc("data:image/png;base64,AAAB")).not.toBe(a);
  });
});
