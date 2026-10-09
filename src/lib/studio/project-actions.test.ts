import { describe, expect, it } from "vitest";
import {
  applyProjectDuplicate,
  applyProjectRename,
  isSafeProjectId,
  normalizeProjectTitle,
  prepareImportedProject,
  projectExportFilename,
} from "./project-actions";

describe("isSafeProjectId", () => {
  it("accepts short ids", () => {
    expect(isSafeProjectId("abc123XYZ")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(isSafeProjectId("../secret")).toBe(false);
    expect(isSafeProjectId("a/b")).toBe(false);
    expect(isSafeProjectId("a\\b")).toBe(false);
    expect(isSafeProjectId("")).toBe(false);
  });
});

describe("normalizeProjectTitle", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeProjectTitle("  我的   项目  ")).toBe("我的 项目");
  });

  it("rejects empty titles", () => {
    expect(normalizeProjectTitle("   ")).toBeNull();
  });
});

describe("applyProjectRename", () => {
  it("updates title and updatedAt, keeps id", () => {
    const next = applyProjectRename(
      {
        id: "p1",
        slug: "p1",
        title: "旧名",
        rawIdea: "idea",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        pages: [],
      },
      "新名字",
      "2026-08-19T00:00:00.000Z"
    );
    expect(next?.id).toBe("p1");
    expect(next?.title).toBe("新名字");
    expect(next?.updatedAt).toBe("2026-08-19T00:00:00.000Z");
  });

  it("returns null when title is empty", () => {
    expect(
      applyProjectRename(
        {
          id: "p1",
          slug: "p1",
          title: "旧名",
          rawIdea: "idea",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          pages: [],
        },
        "  "
      )
    ).toBeNull();
  });
});

describe("projectExportFilename", () => {
  it("prefers slug", () => {
    expect(projectExportFilename({ id: "p1", slug: "demo-app" })).toBe(
      "demo-app.project.json"
    );
  });

  it("falls back to id", () => {
    expect(projectExportFilename({ id: "p1", slug: "" })).toBe("p1.project.json");
  });
});

describe("prepareImportedProject", () => {
  const sample = {
    id: "abc12XYZ",
    slug: "demo",
    title: "演示",
    rawIdea: "idea",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    pages: [],
  };

  it("keeps the original id when it is free", () => {
    expect(prepareImportedProject(sample, [], "dup99NEW").id).toBe("abc12XYZ");
  });

  it("duplicates when the id already exists", () => {
    const next = prepareImportedProject(sample, ["abc12XYZ"], "dup99NEW");
    expect(next.id).toBe("dup99NEW");
    expect(next.title).toBe("演示 副本");
  });

  it("rejects payloads that are not a project", () => {
    expect(() => prepareImportedProject({ title: "x" }, [], "dup99NEW")).toThrow(
      "invalid_project"
    );
  });
});

describe("applyProjectDuplicate", () => {
  it("assigns a new id, copy title, and rewrites asset urls", () => {
    const next = applyProjectDuplicate(
      {
        id: "abc12XYZ",
        slug: "demo",
        title: "演示",
        rawIdea: "idea",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        pages: [],
        assets: [
          {
            id: "a1",
            src: "/api/assets/abc12XYZ/assets/a1.png",
            status: "ready",
          } as never,
        ],
      },
      "dup99NEW",
      "2026-08-19T00:00:00.000Z"
    );
    expect(next.id).toBe("dup99NEW");
    expect(next.slug).toBe("demo-copy");
    expect(next.title).toBe("演示 副本");
    expect(next.createdAt).toBe("2026-08-19T00:00:00.000Z");
    expect(next.assets?.[0]?.src).toBe("/api/assets/dup99NEW/assets/a1.png");
    expect(next.id).not.toBe("abc12XYZ");
  });

  it("does not keep the original user folder so two projects cannot share one workspace", () => {
    const next = applyProjectDuplicate(
      {
        id: "abc12XYZ",
        slug: "demo",
        title: "演示",
        rawIdea: "idea",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        pages: [],
        workspacePath: "E:/work/cover",
      },
      "dup99NEW",
      "2026-08-19T00:00:00.000Z",
    );
    expect(next.workspacePath).toBeUndefined();
  });
});
