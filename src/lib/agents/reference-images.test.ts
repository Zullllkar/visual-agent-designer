import { describe, expect, it } from "vitest";
import {
  appendReferenceStyleHint,
  collectProjectReferenceImages,
  groundPromptToCitedReferences,
  resolveCitedVisualAsset,
} from "./reference-images";
import type { ProjectFile } from "@/lib/project/schema";
import { parsePageReference } from "./orchestrator-planner";

function projectWithRefs(
  refs: Array<{ id: string; label: string; src: string; createdAt: string }>
): ProjectFile {
  return {
    id: "p1",
    title: "Demo",
    slug: "demo",
    rawIdea: "idea",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    outputTargets: ["cursor"],
    references: refs.map((ref) => ({
      ...ref,
      width: 100,
      height: 100,
      source: "clipboard" as const,
    })),
  } as ProjectFile;
}

describe("collectProjectReferenceImages", () => {
  it("keeps only cited ids and does not pad with other project references", () => {
    const project = projectWithRefs([
      {
        id: "old",
        label: "old.png",
        src: "data:image/png;base64,aa",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "mid",
        label: "mid.png",
        src: "data:image/png;base64,bb",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "new",
        label: "new.png",
        src: "data:image/png;base64,cc",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ]);
    const collected = collectProjectReferenceImages(project, {
      preferIds: ["mid"],
      max: 2,
    });
    expect(collected.ids).toEqual(["mid"]);
    expect(collected.exclusive).toBe(true);
    expect(collected.srcs).toHaveLength(1);
  });

  it("fills newest references only when the user did not cite any", () => {
    const project = projectWithRefs([
      {
        id: "old",
        label: "old.png",
        src: "data:image/png;base64,aa",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "mid",
        label: "mid.png",
        src: "data:image/png;base64,bb",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "new",
        label: "new.png",
        src: "data:image/png;base64,cc",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ]);
    const collected = collectProjectReferenceImages(project, { max: 2 });
    expect(collected.ids).toEqual(["new", "mid"]);
    expect(collected.exclusive).toBe(false);
  });

  it("skips unusable svg data urls", () => {
    const project = projectWithRefs([
      {
        id: "svg",
        label: "x.svg",
        src: "data:image/svg+xml;base64,abc",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
      {
        id: "png",
        label: "x.png",
        src: "data:image/png;base64,cc",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    const collected = collectProjectReferenceImages(project);
    expect(collected.ids).toEqual(["png"]);
  });

  it("resolves cited canvas assets and from-asset ids", () => {
    const project = {
      ...projectWithRefs([
        {
          id: "from-asset-xoptr9m4W3",
          label: "Cyberpunk alley",
          src: "/api/assets/p1/assets/xoptr9m4W3.png",
          createdAt: "2026-01-03T00:00:00.000Z",
        },
      ]),
      assets: [
        {
          id: "xoptr9m4W3",
          prompt: "Cyberpunk city street at night",
          src: "/api/assets/p1/assets/xoptr9m4W3.png",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-01-02T00:00:00.000Z",
          status: "candidate" as const,
        },
      ],
    } as ProjectFile;
    const collected = collectProjectReferenceImages(project, {
      preferIds: ["from-asset-xoptr9m4W3", "xoptr9m4W3"],
    });
    expect(collected.srcs).toEqual(["/api/assets/p1/assets/xoptr9m4W3.png"]);
    expect(collected.parentAssetId).toBe("xoptr9m4W3");
    expect(collected.exclusive).toBe(true);
  });

  it("uses the connected parent when citing an empty spawned child, not the latest generated image", () => {
    const project = {
      ...projectWithRefs([
        {
          id: "from-asset-latest",
          label: "last.png",
          src: "data:image/png;base64,last",
          createdAt: "2026-09-17T08:00:00.000Z",
        },
      ]),
      assets: [
        {
          id: "parent-shop",
          prompt: "夜市摊位",
          src: "data:image/png;base64,parent",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T04:00:00.000Z",
          status: "candidate" as const,
        },
        {
          id: "empty-child",
          prompt: "",
          src: "",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T07:00:00.000Z",
          status: "candidate" as const,
          parentAssetId: "parent-shop",
        },
        {
          id: "latest-gen",
          prompt: "另一张最新图",
          src: "data:image/png;base64,last",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T08:00:00.000Z",
          status: "candidate" as const,
        },
      ],
    } as ProjectFile;
    const collected = collectProjectReferenceImages(project, {
      preferIds: ["empty-child"],
    });
    expect(collected.ids).toEqual(["parent-shop"]);
    expect(collected.srcs).toEqual(["data:image/png;base64,parent"]);
    expect(collected.parentAssetId).toBe("parent-shop");
    expect(collected.exclusive).toBe(true);
  });

  it("keeps the connected parent as the reference even when the derived child already has an image", () => {
    const project = {
      ...projectWithRefs([]),
      assets: [
        {
          id: "parent-shop",
          prompt: "夜市摊位",
          src: "data:image/png;base64,parent",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T04:00:00.000Z",
          status: "candidate" as const,
        },
        {
          id: "derived-child",
          prompt: "提高对比度",
          src: "data:image/png;base64,child",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T07:00:00.000Z",
          status: "candidate" as const,
          parentAssetId: "parent-shop",
        },
      ],
    } as ProjectFile;
    const collected = collectProjectReferenceImages(project, {
      preferIds: ["derived-child"],
    });
    expect(collected.ids).toEqual(["parent-shop"]);
    expect(collected.srcs).toEqual(["data:image/png;base64,parent"]);
    expect(collected.parentAssetId).toBe("parent-shop");
    expect(collected.exclusive).toBe(true);
  });
});

describe("resolveCitedVisualAsset", () => {
  it("walks from an empty child to the connected parent", () => {
    const project = {
      ...projectWithRefs([]),
      assets: [
        {
          id: "parent-shop",
          prompt: "夜市摊位",
          src: "data:image/png;base64,parent",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T04:00:00.000Z",
          status: "candidate" as const,
        },
        {
          id: "empty-child",
          prompt: "",
          src: "",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T07:00:00.000Z",
          status: "candidate" as const,
          parentAssetId: "parent-shop",
        },
      ],
    } as ProjectFile;
    expect(resolveCitedVisualAsset(project, "empty-child")?.id).toBe("parent-shop");
    expect(resolveCitedVisualAsset(project, "from-asset-empty-child")?.id).toBe(
      "parent-shop"
    );
  });

  it("prefers the linked parent over a derived child's own image", () => {
    const project = {
      ...projectWithRefs([]),
      assets: [
        {
          id: "parent-shop",
          prompt: "夜市摊位",
          src: "data:image/png;base64,parent",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T04:00:00.000Z",
          status: "candidate" as const,
        },
        {
          id: "derived-child",
          prompt: "提高对比度",
          src: "data:image/png;base64,child",
          width: 1024,
          height: 1024,
          model: "test",
          createdAt: "2026-09-17T07:00:00.000Z",
          status: "candidate" as const,
          parentAssetId: "parent-shop",
        },
      ],
    } as ProjectFile;
    expect(resolveCitedVisualAsset(project, "derived-child")?.id).toBe("parent-shop");
  });
});

describe("groundPromptToCitedReferences", () => {
  it("locks style to the attached image and ignores project design context", () => {
    const grounded = groundPromptToCitedReferences(
      "Deep Charcoal Black #0A0C10, Cyan #2DD4BF glassmorphism pricing page UI",
      {
        cited: true,
        labels: ["Ultra premium hero"],
        userIntent: "按照这个风格弄价格页面",
      },
    );
    expect(grounded.startsWith("The attached reference image is the only visual style source.")).toBe(
      true,
    );
    expect(grounded).toContain("User request: 按照这个风格弄价格页面");
    expect(grounded).toContain("Deep Charcoal Black");
    expect(grounded).not.toMatch(/and composition of the attached/);
  });

  it("falls back to the ambient style hint when nothing was cited", () => {
    const hinted = groundPromptToCitedReferences("A hero shot", {
      cited: false,
      labels: ["mood.png"],
    });
    expect(hinted).toContain("mood.png");
    expect(hinted).toContain("composition");
  });
});

describe("appendReferenceStyleHint", () => {
  it("appends once", () => {
    const once = appendReferenceStyleHint("A hero shot", ["mood.png"]);
    expect(once).toContain("mood.png");
    const twice = appendReferenceStyleHint(once, ["mood.png"]);
    expect(twice).toBe(once);
  });
});

describe("parsePageReference reference prefixes", () => {
  it("strips multiple 【参考图】 prefixes", () => {
    const parsed = parsePageReference(
      "【参考图: a.png#ref1】【参考图: b.png#ref2】生成一张海报"
    );
    expect(parsed.referenceIds).toEqual(["ref1", "ref2"]);
    expect(parsed.referenceLabels).toEqual(["a.png", "b.png"]);
    expect(parsed.cleanText).toBe("生成一张海报");
  });

  it("keeps selection prefix and reference prefixes together", () => {
    const parsed = parsePageReference(
      "【引用素材: Hero#asset9】 【参考图: style#ref3】换配色"
    );
    expect(parsed.assetId).toBe("asset9");
    expect(parsed.referenceIds).toEqual(["ref3"]);
    expect(parsed.cleanText).toBe("换配色");
  });
});
