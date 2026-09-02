import { describe, expect, it } from "vitest";

import {
  applyFamilyTitle,
  familyBoardPageName,
  isAutoFamilyBoardLabel,
  resolveFamilyBoardTitle,
} from "./family-board-title";

describe("isAutoFamilyBoardLabel", () => {
  it("detects the old drag-hint labels", () => {
    expect(isAutoFamilyBoardLabel("拖整组 · 2 个派生")).toBe(true);
    expect(isAutoFamilyBoardLabel("Drag group · 2 derived")).toBe(true);
    expect(isAutoFamilyBoardLabel("定价方案")).toBe(false);
  });
});

describe("familyBoardPageName", () => {
  it("prefers the canvas page bound to the root asset", () => {
    expect(
      familyBoardPageName({
        usedInPages: ["pricing"],
        pages: [{ id: "pricing", name: "定价页" }],
        architecturePages: [{ id: "home", name: "首页" }],
      })
    ).toBe("定价页");
  });

  it("falls back to architecture page names", () => {
    expect(
      familyBoardPageName({
        usedInPages: ["home"],
        pages: [],
        architecturePages: [{ id: "home", name: "首页" }],
      })
    ).toBe("首页");
  });

  it("does not invent a page name when nothing is bound", () => {
    expect(
      familyBoardPageName({
        usedInPages: [],
        architecturePages: [{ id: "home", name: "首页" }],
      })
    ).toBe("");
  });
});

describe("resolveFamilyBoardTitle", () => {
  it("keeps a persisted family title", () => {
    expect(
      resolveFamilyBoardTitle({
        familyTitle: "  定价方案  ",
        currentLabel: "拖整组 · 2 个派生",
        pageName: "首页",
      })
    ).toBe("定价方案");
  });

  it("keeps an in-progress custom label over a persisted title", () => {
    expect(
      resolveFamilyBoardTitle({
        familyTitle: "定价方案",
        currentLabel: "登录页",
        pageName: "首页",
      })
    ).toBe("登录页");
  });

  it("replaces the auto hint with the bound page name", () => {
    expect(
      resolveFamilyBoardTitle({
        familyTitle: "",
        currentLabel: "拖整组 · 2 个派生",
        pageName: "定价页",
      })
    ).toBe("定价页");
  });
});

describe("applyFamilyTitle", () => {
  it("writes the title onto the family root only", () => {
    const assets = [
      { id: "root", familyTitle: "旧名" },
      { id: "child" },
    ];
    expect(applyFamilyTitle(assets, "root", "  定价方案  ")).toEqual([
      { id: "root", familyTitle: "定价方案" },
      { id: "child" },
    ]);
  });
});
