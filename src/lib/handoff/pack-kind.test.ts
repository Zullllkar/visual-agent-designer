import { describe, expect, it } from "vitest";

import { createHandoffTarget } from "./markdown-target";
import { buildHandoffPreflight } from "./preflight";
import {
  coerceHandoffExportTarget,
  listHandoffDestinations,
  resolveHandoffPackKind,
} from "./pack-kind";
import type { ProjectFile } from "@/lib/project/schema";
import type { HandoffTarget } from "./types";

function makeProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "project-1",
    slug: "project-1",
    title: "Test Project",
    rawIdea: "像素仙侠门派山门立绘",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    assets: [
      {
        id: "asset-1",
        prompt: "pixel xianxia gate",
        src: "data:image/png;base64,aaa",
        width: 1280,
        height: 720,
        model: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "starred",
        role: "portrait",
      },
    ],
    ...overrides,
  };
}

async function packPaths(
  project: ProjectFile,
  target: HandoffTarget["name"] = "cursor"
) {
  const artifact = await createHandoffTarget(target).build({
    project,
    screenshots: [],
    aiReferenceImages: [],
  });
  return artifact.files.map((file) => file.path);
}

function fileText(
  files: Array<{ path: string; content: string | Uint8Array }>,
  path: string
): string {
  const found = files.find((file) => file.path === path);
  if (!found || typeof found.content !== "string") return "";
  return found.content;
}

describe("resolveHandoffPackKind", () => {
  it("keeps missing target as code-kickoff for existing UI projects", () => {
    expect(resolveHandoffPackKind({})).toBe("code-kickoff");
    expect(resolveHandoffPackKind({ targetId: "ui-visual" })).toBe("code-kickoff");
  });

  it("maps each visual target to its recipe pack", () => {
    expect(resolveHandoffPackKind({ targetId: "game-art" })).toBe("art-bible");
    expect(resolveHandoffPackKind({ targetId: "promo-kv" })).toBe("media-pack");
    expect(resolveHandoffPackKind({ targetId: "social-cover" })).toBe("media-pack");
    expect(resolveHandoffPackKind({ targetId: "product-shot" })).toBe("media-pack");
    expect(resolveHandoffPackKind({ targetId: "style-board" })).toBe("none");
  });
});

describe("handoff destinations", () => {
  it("keeps Cursor / Claude / Codex only for UI code-kickoff", () => {
    const ids = listHandoffDestinations("code-kickoff").map((item) => item.id);
    expect(ids).toEqual(["cursor", "claude-code", "codex", "markdown"]);
  });

  it("does not offer coding-agent destinations for art or media packs", () => {
    expect(listHandoffDestinations("art-bible").map((item) => item.id)).toEqual([
      "markdown",
    ]);
    expect(listHandoffDestinations("media-pack").map((item) => item.id)).toEqual([
      "markdown",
    ]);
    expect(listHandoffDestinations("none").map((item) => item.id)).toEqual([
      "markdown",
    ]);
  });

  it("coerces coding targets to markdown when the pack is not for coding agents", () => {
    expect(coerceHandoffExportTarget("art-bible", "cursor")).toBe("markdown");
    expect(coerceHandoffExportTarget("code-kickoff", "cursor")).toBe("cursor");
  });
});

describe("createHandoffTarget pack files", () => {
  it("keeps the existing UI coding package", async () => {
    const paths = await packPaths(
      makeProject({
        targetId: "ui-visual",
        rawIdea: "健身 App 今日训练首页",
        brief: {
          productName: "Fit",
          positioning: "训练首页",
          targetUser: "健身用户",
          scenarios: ["开训"],
          coreFeatures: ["计划"],
          platform: "app",
          visualStyle: "clean",
          outputTargets: ["cursor"],
        },
      }),
      "cursor"
    );
    expect(paths).toContain("IMPLEMENTATION.md");
    expect(paths).toContain("SPEC.md");
    expect(paths).toContain(".cursorrules");
    expect(paths).toContain("prompts/cursor-kickoff.md");
    expect(paths).toContain("design/tokens.dtcg.json");
  });

  it("exports game-art as an art bible, not a React kickoff", async () => {
    const artifact = await createHandoffTarget("cursor").build({
      project: makeProject({
        targetId: "game-art",
        brief: {
          productName: "门派山门",
          positioning: "仙侠门派",
          targetUser: "玩家与美术",
          scenarios: ["立绘"],
          coreFeatures: ["角色立绘", "像素"],
          platform: "other",
          visualStyle: "chunky pixel concept art",
          outputTargets: ["markdown"],
          slots: { assetKind: "portrait", render: "pixel", world: "仙侠门派" },
        },
        designDirection: {
          summary: "像素仙侠",
          moodKeywords: ["jade"],
        },
        directionCardId: "pixel-xianxia",
      }),
      screenshots: [],
      aiReferenceImages: [],
    });
    const paths = artifact.files.map((file) => file.path);
    expect(paths).toContain("ART_BIBLE.md");
    expect(paths).toContain("ASSET_USAGE.md");
    expect(paths).not.toContain("IMPLEMENTATION.md");
    expect(paths).not.toContain(".cursorrules");
    expect(paths.filter((path) => path.includes("kickoff"))).toEqual([]);
    expect(paths.filter((path) => path.startsWith("design/specs/"))).toEqual([]);
    expect(fileText(artifact.files, "ART_BIBLE.md")).toMatch(/像素|仙侠|立绘/);
    expect(fileText(artifact.files, "README.md")).not.toMatch(/coding agent/i);
  });

  it("exports social-cover with a copy sheet instead of implementation plan", async () => {
    const artifact = await createHandoffTarget("markdown").build({
      project: makeProject({
        targetId: "social-cover",
        rawIdea: "小红书开箱封面",
        brief: {
          productName: "开箱封面",
          positioning: "三步讲清",
          targetUser: "社媒浏览者",
          scenarios: ["竖版封面"],
          coreFeatures: ["小红书"],
          platform: "other",
          visualStyle: "vertical social cover",
          outputTargets: ["markdown"],
          slots: { platform: "xhs", hook: "开箱三步", face: "product" },
        },
      }),
      screenshots: [],
      aiReferenceImages: [],
    });
    const paths = artifact.files.map((file) => file.path);
    expect(paths).toContain("COPY.md");
    expect(paths).toContain("ASSET_USAGE.md");
    expect(paths).not.toContain("IMPLEMENTATION.md");
    expect(fileText(artifact.files, "COPY.md")).toMatch(/开箱三步|小红书/);
  });

  it("marks style-board as a draft pack, not a construction kit", async () => {
    const artifact = await createHandoffTarget("markdown").build({
      project: makeProject({
        targetId: "style-board",
        brief: {
          productName: "茶饮方向",
          positioning: "纸感 雾绿",
          targetUser: "选方向的人",
          scenarios: ["并排试方向"],
          coreFeatures: ["纸感", "雾绿"],
          platform: "other",
          visualStyle: "style exploration",
          outputTargets: ["markdown"],
          slots: { category: "茶饮", words: "纸感 雾绿 手写" },
        },
      }),
      screenshots: [],
      aiReferenceImages: [],
    });
    const paths = artifact.files.map((file) => file.path);
    expect(paths).toContain("STYLE_NOTES.md");
    expect(paths).not.toContain("IMPLEMENTATION.md");
    expect(paths).not.toContain("prompts/markdown-kickoff.md");
    expect(fileText(artifact.files, "README.md")).toMatch(/草稿|探索|draft/i);
  });
});

describe("preflight by pack kind", () => {
  it("does not warn game-art about missing UI specs or materials", () => {
    const result = buildHandoffPreflight(
      makeProject({ targetId: "game-art" }),
      { selectedAssetIds: ["asset-1"], selectedReferenceIds: [] }
    );
    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.id === "design-specs")?.level).toBe(
      "ok"
    );
    expect(result.checks.find((check) => check.id === "materials")?.level).toBe(
      "ok"
    );
    expect(result.checks.find((check) => check.id === "materials")?.detail).toMatch(
      /不拆解|美术包/
    );
  });

  it("still warns ui-visual about missing design specs", () => {
    const result = buildHandoffPreflight(
      makeProject({
        targetId: "ui-visual",
        rawIdea: "健身 App 首页",
      }),
      { selectedAssetIds: ["asset-1"], selectedReferenceIds: [] }
    );
    expect(result.checks.find((check) => check.id === "design-specs")?.level).toBe(
      "warning"
    );
  });
});
