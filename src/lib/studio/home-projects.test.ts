import { describe, expect, it } from "vitest";
import type { ProjectFile } from "@/lib/project/schema";
import {
  formatLibraryDate,
  latestStudioProjects,
  paginateStudioLibrary,
  projectMatchesLibraryTarget,
} from "./home-projects";

function project(id: string, updatedAt: string): ProjectFile {
  return {
    id,
    slug: id,
    title: id,
    rawIdea: "",
    createdAt: updatedAt,
    updatedAt,
    pages: [],
    assets: [],
    references: [],
  };
}

describe("latestStudioProjects", () => {
  it("keeps at most four newest projects", () => {
    const shown = latestStudioProjects([
      project("a", "2026-08-01T00:00:00.000Z"),
      project("b", "2026-08-20T00:00:00.000Z"),
      project("c", "2026-08-10T00:00:00.000Z"),
      project("d", "2026-08-18T00:00:00.000Z"),
      project("e", "2026-08-15T00:00:00.000Z"),
    ]);

    expect(shown.map((item) => item.id)).toEqual(["b", "d", "e", "c"]);
  });
});

describe("formatLibraryDate", () => {
  it("formats a compact local date", () => {
    expect(formatLibraryDate("2026-08-14T00:00:00.000Z")).toMatch(/^2026\./);
  });
});

describe("paginateStudioLibrary", () => {
  const ids = Array.from({ length: 25 }, (_, index) => `p${index + 1}`);

  it("keeps twelve items on the first page", () => {
    const result = paginateStudioLibrary(ids, 1);
    expect(result.items).toEqual(ids.slice(0, 12));
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(3);
    expect(result.total).toBe(25);
  });

  it("returns the remainder on the last page", () => {
    const result = paginateStudioLibrary(ids, 3);
    expect(result.items).toEqual(["p25"]);
    expect(result.page).toBe(3);
  });

  it("clamps a page past the end", () => {
    const result = paginateStudioLibrary(ids, 9);
    expect(result.page).toBe(3);
    expect(result.items).toEqual(["p25"]);
  });

  it("clamps a page below one", () => {
    const result = paginateStudioLibrary(ids, 0);
    expect(result.page).toBe(1);
    expect(result.items[0]).toBe("p1");
  });

  it("treats an empty list as a single empty page", () => {
    const result = paginateStudioLibrary([], 4);
    expect(result).toMatchObject({ items: [], page: 1, pageCount: 1, total: 0 });
  });
});

describe("projectMatchesLibraryTarget", () => {
  it("keeps every project on all", () => {
    expect(projectMatchesLibraryTarget("game-art", "all")).toBe(true);
    expect(projectMatchesLibraryTarget(undefined, "all")).toBe(true);
  });

  it("matches a concrete canvas target", () => {
    expect(projectMatchesLibraryTarget("ui-visual", "ui-visual")).toBe(true);
    expect(projectMatchesLibraryTarget("game-art", "ui-visual")).toBe(false);
  });

  it("treats missing or unknown targets as 界面视觉", () => {
    expect(projectMatchesLibraryTarget(undefined, "ui-visual")).toBe(true);
    expect(projectMatchesLibraryTarget("not-a-target", "ui-visual")).toBe(true);
    expect(projectMatchesLibraryTarget(undefined, "game-art")).toBe(false);
  });
});
