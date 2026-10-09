import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectWorkspaceFolder } from "./inspect-workspace";
import { WORKSPACE_SIDECAR } from "@/lib/studio/workspace";

const tempRoot = { current: "" };

describe("inspectWorkspaceFolder", () => {
  beforeEach(async () => {
    tempRoot.current = await mkdtemp(join(tmpdir(), "vad-ws-"));
  });

  afterEach(async () => {
    await rm(tempRoot.current, { recursive: true, force: true });
  });

  it("creates a new project in an empty user folder instead of the app data dir", async () => {
    const folder = join(tempRoot.current, "fitness-app");
    const vadRoot = join(tempRoot.current, ".vad");
    const result = await inspectWorkspaceFolder({
      path: folder,
      vadRoot,
      idea: "健身训练首页",
      mkdirIfMissing: true,
    });
    expect(result.created).toBe(true);
    expect(result.workspacePath).toBe(folder);
    expect(result.project.workspacePath).toBe(folder);
    expect(result.project.rawIdea).toBe("健身训练首页");
    expect(result.project.id).not.toMatch(/pending/);
  });

  it("reopens an existing .vibeboard project in that folder", async () => {
    const folder = join(tempRoot.current, "fitness-app");
    const sidecar = join(folder, WORKSPACE_SIDECAR);
    await mkdir(sidecar, { recursive: true });
    await writeFile(
      join(sidecar, "project.json"),
      JSON.stringify({
        id: "keepme12ab",
        slug: "keepme12ab",
        title: "已有项目",
        rawIdea: "旧 brief",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        pages: [],
      }),
      "utf8",
    );
    const result = await inspectWorkspaceFolder({
      path: folder,
      vadRoot: join(tempRoot.current, ".vad"),
    });
    expect(result.created).toBe(false);
    expect(result.project.id).toBe("keepme12ab");
    expect(result.project.title).toBe("已有项目");
    expect(result.project.workspacePath).toBe(folder);
  });

  it("refuses the app .vad directory", async () => {
    const vadRoot = join(tempRoot.current, ".vad");
    await mkdir(join(vadRoot, "projects"), { recursive: true });
    await expect(
      inspectWorkspaceFolder({
        path: join(vadRoot, "projects", "abc"),
        vadRoot,
      }),
    ).rejects.toThrow(/数据目录/);
  });
});
