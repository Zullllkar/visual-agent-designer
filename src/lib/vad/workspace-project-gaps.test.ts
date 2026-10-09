import { describe, expect, it } from "vitest";

import { mergeProjectsById } from "@/lib/vad/merge-project-lists";
import { canDuplicateProjectDirs } from "@/lib/vad/project-dir-guard";

describe("mergeProjectsById", () => {
  it("keeps workspace-folder projects that daemon list omitted", () => {
    const merged = mergeProjectsById(
      [{ id: "app-dir", title: "应用目录", updatedAt: "2026-01-02T00:00:00.000Z" }],
      [
        {
          id: "xiaohongshu-cover",
          title: "封面",
          workspacePath: "E:/work/cover",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    );
    expect(merged.map((p) => p.id)).toEqual([
      "xiaohongshu-cover",
      "app-dir",
    ]);
  });
});

describe("canDuplicateProjectDirs", () => {
  it("allows copying a user-folder sidecar into the app projects dir", () => {
    expect(
      canDuplicateProjectDirs({
        src: "E:/work/cover/.vibeboard",
        dest: "E:/app/.vad/projects/dup99NEW",
        projectsRoot: "E:/app/.vad/projects",
      }),
    ).toBe(true);
  });

  it("rejects copying into another user folder", () => {
    expect(
      canDuplicateProjectDirs({
        src: "E:/work/cover/.vibeboard",
        dest: "E:/work/cover-copy/.vibeboard",
        projectsRoot: "E:/app/.vad/projects",
      }),
    ).toBe(false);
  });
});
