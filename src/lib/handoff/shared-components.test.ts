import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LayoutIR, LayoutNode } from "./layout-ir";
import { buildSharedComponentIndex, renderComponentsMd } from "./shared-components";

function asset(id: string, prompt: string): ImageAsset {
  return {
    id,
    prompt,
    src: `data:image/png;base64,${id}`,
    width: 1440,
    height: 900,
    model: "m",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "candidate",
  };
}

const code = (
  id: string,
  role: Extract<LayoutNode, { rebuildInCode: true }>["role"],
  bbox: { x: number; y: number; w: number; h: number },
  extra: Partial<Extract<LayoutNode, { rebuildInCode: true }>> = {},
): LayoutNode => ({ id, role, bbox, rebuildInCode: true, media: null, ...extra });

function layout(id: string, nodes: LayoutNode[]): LayoutIR {
  return {
    version: 1,
    mockupAssetId: id,
    width: 1440,
    height: 900,
    referenceImage: "x.png",
    nodes,
  };
}

function project(layouts: Record<string, LayoutIR>, prompts: Record<string, string>): ProjectFile {
  return {
    id: "p",
    slug: "p",
    title: "Acme",
    rawIdea: "idea",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    assets: Object.keys(layouts).map((id) => asset(id, prompts[id] ?? id)),
    materializations: Object.fromEntries(
      Object.entries(layouts).map(([id, l]) => [
        id,
        { mockupAssetId: id, layout: l, createdAt: "", updatedAt: "" },
      ]),
    ),
  } as ProjectFile;
}

describe("buildSharedComponentIndex", () => {
  const purple = { dominant: "#7C3AED" };
  const p = project(
    {
      home: layout("home", [
        code(
          "nav",
          "nav",
          { x: 0, y: 0, w: 1, h: 0.08 },
          { copy: "Home · Pricing · Docs", states: [{ name: "active", notes: "" }] },
        ),
        code(
          "cta",
          "cta",
          { x: 0.4, y: 0.5, w: 0.2, h: 0.06 },
          { copy: "Start free", swatch: purple, states: [{ name: "hover", notes: "" }] },
        ),
        code("body", "main", { x: 0, y: 0.1, w: 1, h: 0.7 }),
        code("foot", "footer", { x: 0, y: 0.9, w: 1, h: 0.1 }),
      ]),
      pricing: layout("pricing", [
        code(
          "topbar",
          "nav",
          { x: 0, y: 0, w: 1, h: 0.08 },
          { copy: "Home · Pricing · Docs", states: [{ name: "hover", notes: "" }] },
        ),
        code(
          "buy",
          "cta",
          { x: 0.7, y: 0.6, w: 0.2, h: 0.06 },
          { copy: "Buy Pro", swatch: purple },
        ),
        code(
          "ghost",
          "cta",
          { x: 0.1, y: 0.6, w: 0.2, h: 0.06 },
          { copy: "Contact sales", swatch: { dominant: "#FFFFFF" } },
        ),
        code("foot", "footer", { x: 0, y: 0.9, w: 1, h: 0.1 }),
      ]),
      settings: layout("settings", [
        code("side", "sidebar", { x: 0, y: 0, w: 0.2, h: 1 }),
        code("main", "main", { x: 0.2, y: 0, w: 0.8, h: 1 }),
      ]),
    },
    { home: "Landing home", pricing: "Pricing page", settings: "Settings" },
  );

  it("groups top nav, footer and same-colored CTAs across screens; leaves singletons out", () => {
    const idx = buildSharedComponentIndex(p);
    const byName = Object.fromEntries(idx.components.map((c) => [c.name, c]));

    expect(Object.keys(byName).sort()).toEqual(["AppFooter", "AppNav", "PrimaryButton"]);

    expect(byName.AppNav.screenCount).toBe(2);
    expect(byName.AppNav.copyVariants).toEqual(["Home · Pricing · Docs"]);
    expect(byName.AppNav.states.sort()).toEqual(["active", "hover"]);

    expect(byName.PrimaryButton.screenCount).toBe(2);
    expect(byName.PrimaryButton.copyVariants).toEqual(["Start free", "Buy Pro"]);
    expect(byName.PrimaryButton.swatch).toEqual({ dominant: "#7C3AED", accent: undefined });
    // 白色的 ghost 按钮颜色不同，不被并进主按钮
    expect(byName.PrimaryButton.instances.map((i) => i.nodeId)).toEqual(["cta", "buy"]);

    // sidebar 只在一屏、main 永远不归并
    expect(idx.byScreen.settings).toBeUndefined();
    expect(idx.byScreen.home).toEqual({
      nav: "app-nav",
      cta: "primary-button",
      foot: "app-footer",
    });
    expect(idx.byScreen.pricing.topbar).toBe("app-nav");
  });

  it("orders by screen count then name and renders COMPONENTS.md", () => {
    const idx = buildSharedComponentIndex(p);
    expect(idx.components.map((c) => c.name)).toEqual(["AppFooter", "AppNav", "PrimaryButton"]);
    const md = renderComponentsMd(idx);
    expect(md).toContain("## AppNav (`app-nav`) — 2 screens");
    expect(md).toContain('- Landing home (`home`) → node `nav` — "Home · Pricing · Docs"');
    expect(md).toContain('Copy variants: "Start free", "Buy Pro"');
    expect(md).toContain("Fill: `#7C3AED`");
  });

  it("says so when nothing is shared", () => {
    const solo = project(
      { only: layout("only", [code("cta", "cta", { x: 0, y: 0, w: 0.2, h: 0.06 })]) },
      {},
    );
    const idx = buildSharedComponentIndex(solo);
    expect(idx.components).toEqual([]);
    expect(renderComponentsMd(idx)).toMatch(/No cross-screen components/);
  });
});
