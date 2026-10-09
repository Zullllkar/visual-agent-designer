import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { ToolContext } from "./types";
import { upsertCanvasNoteTool } from "./upsert-canvas-note";

function asset(id: string): ImageAsset {
  return {
    id,
    prompt: "hero",
    src: "data:image/png;base64,x",
    width: 1024,
    height: 1024,
    model: "t",
    createdAt: "2026-09-17T00:00:00.000Z",
    status: "candidate",
  };
}

function ctx(project: ProjectFile): ToolContext {
  return {
    project,
    userMessage: "",
    agentCtx: {
      projectId: project.id,
      scratch: {},
      providers: { llm: {} as never, image: {} as never, visionCritic: false },
    },
  };
}

function project(assets: ImageAsset[] = []): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "t",
    rawIdea: "idea",
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    pages: [],
    assets,
  };
}

describe("upsert_canvas_note", () => {
  it("creates a standalone copy card", async () => {
    const result = await upsertCanvasNoteTool.execute(
      { kind: "copy", title: "口号", body: "修仙从像素开始。" },
      ctx(project())
    );
    expect(result.updatedProject?.canvasNotes).toHaveLength(1);
    expect(result.updatedProject?.canvasNotes?.[0]).toMatchObject({
      kind: "copy",
      title: "口号",
      body: "修仙从像素开始。",
    });
  });

  it("fills an existing cited note by id", async () => {
    const seeded = project([asset("hero")]);
    seeded.canvasNotes = [
      {
        id: "note-1",
        kind: "script",
        title: "脚本",
        body: "",
        parentAssetId: "hero",
        createdAt: "2026-09-17T00:00:00.000Z",
      },
    ];
    const result = await upsertCanvasNoteTool.execute(
      { id: "note-1", kind: "script", body: "少年踏入仙门。" },
      ctx(seeded)
    );
    expect(result.updatedProject?.canvasNotes?.[0]).toMatchObject({
      id: "note-1",
      body: "少年踏入仙门。",
      parentAssetId: "hero",
    });
  });
});
