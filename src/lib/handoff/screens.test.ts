import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LayoutIR } from "./layout-ir";
import {
  buildScreenTask,
  latestReportByAsset,
  listScreens,
  type ScreenReportLike,
} from "./screens";

function asset(id: string, extra: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id,
    prompt: `mockup ${id}`,
    src: "data:image/png;base64,AAAA",
    width: 1440,
    height: 900,
    model: "m",
    createdAt: `2026-01-0${id.length}T00:00:00.000Z`,
    status: "candidate",
    ...extra,
  };
}

function layoutFor(id: string): LayoutIR {
  return {
    version: 1,
    mockupAssetId: id,
    width: 1440,
    height: 900,
    referenceImage: `assets/final/mockup-${id}.png`,
    nodes: [
      {
        id: "hero",
        parentAssetId: id,
        role: "hero",
        bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.4 },
        rebuildInCode: false,
        prompt: "hero art",
        status: "ready",
        materialAssetId: `${id}-hero`,
        media: `assets/materials/${id}/hero.png`,
        swatch: { dominant: "#181820", accent: "#7C3AED" },
      },
      {
        id: "cta",
        role: "cta",
        bbox: { x: 0.4, y: 0.55, w: 0.2, h: 0.06 },
        rebuildInCode: true,
        copy: "Start free",
        copySource: "plan",
        media: null,
      },
    ],
  };
}

function project(
  assets: ImageAsset[],
  materializations: Record<string, LayoutIR> = {},
): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "Acme",
    rawIdea: "an idea",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    brief: {
      productName: "Acme",
      positioning: "Plan your week",
      targetUser: "makers",
      scenarios: [],
      coreFeatures: [],
      platform: "web",
      visualStyle: "dark, minimal",
      outputTargets: ["cursor"],
    },
    pages: [],
    assets,
    materializations: Object.fromEntries(
      Object.entries(materializations).map(([id, layout]) => [
        id,
        {
          mockupAssetId: id,
          layout,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ),
  } as ProjectFile;
}

const visionSpec = (id: string) =>
  ({
    version: 1,
    assetId: id,
    summary: "Landing hero",
    screenType: "landing",
    layout: "",
    hierarchy: [],
    regions: [],
    tokens: {
      colors: [{ name: "background", value: "#181820", source: "pixels", share: 0.8 }],
      typography: [],
      radii: [],
      spacingHints: [],
    },
    components: [],
    doNot: [],
    implementationNotes: ["Use real text"],
    copyPlan: [{ id: "c1", role: "cta", text: "Start free" }],
    unplacedCopy: [{ id: "n1", role: "nav", text: "Pricing" }],
    source: "vision",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as NonNullable<ImageAsset["designSpec"]>;

describe("listScreens", () => {
  it("orders approved → materialized → starred → rest and computes readiness", () => {
    const p = project(
      [
        asset("a", { status: "starred" }),
        asset("bb"),
        asset("ccc", { approval: { status: "approved" }, designSpec: visionSpec("ccc") }),
        asset("dddd", { source: "materialized", parentAssetId: "ccc" }),
        asset("eeeee", { status: "discarded" }),
      ],
      {
        ccc: layoutFor("ccc"),
        bb: {
          ...layoutFor("bb"),
          nodes: [
            {
              id: "hero",
              parentAssetId: "bb",
              role: "hero",
              bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.4 },
              rebuildInCode: false,
              prompt: "hero art",
              status: "pending",
            },
          ],
        },
      },
    );
    const screens = listScreens(p);
    expect(screens.map((s) => s.assetId)).toEqual(["ccc", "bb", "a"]);
    expect(screens.map((s) => s.order)).toEqual([1, 2, 3]);

    const ccc = screens[0];
    expect(ccc.title).toBe("Landing hero");
    expect(ccc.readiness.level).toBe("ready");
    expect(ccc.readiness.missing).toEqual([]);
    expect(ccc.status).toMatchObject({
      materialized: true,
      mediaSlots: 1,
      materialsReady: 1,
      codeSlots: 1,
      hasPixelPalette: true,
      copyPlanCount: 1,
      unplacedCopyCount: 1,
    });
    expect(ccc.files).toEqual({
      layout: "design/layouts/ccc.json",
      spec: "design/specs/ccc.md",
      materialsDir: "assets/materials/ccc/",
    });

    const bb = screens[1];
    expect(bb.readiness.level).toBe("partial");
    expect(bb.readiness.missing.join("\n")).toMatch(/1 of 1 media slots/);
    expect(bb.readiness.missing.join("\n")).toMatch(/No design spec/);

    const a = screens[2];
    expect(a.readiness.level).toBe("draft");
    expect(a.files.layout).toBeUndefined();
  });

  it("attaches only the latest report per screen", () => {
    const reports: ScreenReportLike[] = [
      {
        id: "r1",
        assetId: "a",
        score: 4,
        verdict: "needs-work",
        createdAt: "2026-02-01T00:00:00.000Z",
        deviations: [dev("high")],
      },
      {
        id: "r2",
        assetId: "a",
        score: 9,
        verdict: "pass",
        createdAt: "2026-02-02T00:00:00.000Z",
        deviations: [],
      },
      {
        id: "r3",
        assetId: "zz",
        score: null,
        verdict: "unreviewed",
        createdAt: "2026-02-02T00:00:00.000Z",
        deviations: [],
      },
    ];
    const screens = listScreens(project([asset("a")]), reports);
    expect(screens[0].implementation).toMatchObject({
      reportId: "r2",
      verdict: "pass",
      score: 9,
      deviations: 0,
    });
    expect(latestReportByAsset(reports).get("a")?.id).toBe("r2");
  });
});

describe("buildScreenTask", () => {
  it("renders scope, region table, copy plan, acceptance and open deviations", () => {
    const p = project(
      [asset("ccc", { approval: { status: "approved" }, designSpec: visionSpec("ccc") })],
      {
        ccc: layoutFor("ccc"),
      },
    );
    const report: ScreenReportLike = {
      id: "r9",
      assetId: "ccc",
      score: 6,
      verdict: "needs-work",
      url: "http://localhost:5173/",
      createdAt: "2026-02-03T00:00:00.000Z",
      deviations: [dev("high"), dev("low")],
    };
    const [screen] = listScreens(p, [report]);
    const md = buildScreenTask(p, screen, report, 3);

    expect(md).toContain("# Screen 1/3: Landing hero");
    expect(md).toContain("Implement **only this screen**");
    expect(md).toContain("design/layouts/ccc.json");
    expect(md).toContain("| `hero` | hero | media |");
    expect(md).toContain("assets/materials/ccc/hero.png");
    expect(md).toContain("| `cta` | cta | code |");
    expect(md).toContain("#181820 / #7C3AED");
    expect(md).toContain("- **cta**: Start free");
    expect(md).toContain("- **nav**: Pricing");
    expect(md).toContain('report_implementation({ assetId: "ccc"');
    expect(md).toContain("verdict **needs-work** · 6/10 · http://localhost:5173/");
    // 只列非 low 的偏差
    expect((md.match(/^- \[high\]/gm) ?? []).length).toBe(1);
    expect(md).not.toMatch(/^- \[low\]/m);
  });
});

describe("listScreens for art packs", () => {
  it("stars first, uses prompt as title, and does not ask for Layout IR", () => {
    const p = {
      ...project([
        asset("office", {
          role: "hero",
          prompt: "2D pixel art cozy startup office at dusk with warm window light",
        }),
        asset("founder", {
          role: "hero",
          prompt: "pixel founder full body hoodie backpack",
          status: "starred",
        }),
      ]),
      targetId: "game-art",
    } as ProjectFile;
    const screens = listScreens(p);
    expect(screens.map((s) => s.assetId)).toEqual(["founder", "office"]);
    expect(screens[0].readiness.level).toBe("ready");
    expect(screens[1].readiness.level).toBe("draft");
    expect(screens[1].readiness.missing.join("\n")).toMatch(/Not starred/);
    expect(screens[0].title).toMatch(/pixel founder/i);
    expect(screens[1].title).toMatch(/startup office/i);

    const md = buildScreenTask(p, screens[0], undefined, 2);
    expect(md).toMatch(/art bible/i);
    expect(md).toMatch(/not.*UI screen/i);
    expect(md).toMatch(/Do \*\*not\*\* call `report_implementation`/);
    expect(md).not.toMatch(/Implement \*\*only this screen\*\*/);
  });
});

function dev(severity: "low" | "medium" | "high") {
  return {
    slot: "hero",
    kind: "spacing",
    severity,
    expected: "64px padding",
    actual: "24px",
    fixHint: "increase hero padding to 64px",
  };
}
