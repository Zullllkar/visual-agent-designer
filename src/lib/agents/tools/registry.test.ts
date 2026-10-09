import { describe, it, expect, beforeEach } from "vitest";
import { toolRegistry } from "@/lib/agents/tools/registry";
import { registerAllTools } from "@/lib/agents/tools";

describe("ToolRegistry", () => {
  beforeEach(() => {
    registerAllTools();
  });

  it("should register all expected tools", () => {
    const names = toolRegistry.names();
    expect(names).toContain("generate_brief");
    expect(names).toContain("plan_design_direction");
    expect(names).toContain("generate_images");
    expect(names).toContain("generate_image_variants");
    expect(names).toContain("restyle_page_images");
    expect(names).toContain("adopt_asset_style");
    expect(names).toContain("export_handoff");
    expect(names).toContain("materialize_mockup");
    expect(names).toContain("answer_question");
    expect(names).toContain("inspect_canvas");
    expect(names).toContain("upsert_canvas_note");
    expect(names).toContain("manipulate_canvas");
    expect(names).toContain("star_asset");
    expect(names).toContain("batch_delete_assets");
  });

  it("should return tool definitions in LlmToolDefinition format", () => {
    const defs = toolRegistry.toToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.parameters).toBeDefined();
    }
  });

  it("marks side-effect tools as requiring confirmation", () => {
    const sideEffectTools = [
      "batch_delete_assets",
      "delegate_task",
      "execute",
      "export_handoff",
      "file_system",
      "generate_image_variants",
      "generate_images",
      "generate_video",
      "materialize_mockup",
      "manipulate_canvas",
      "persist_sandbox_file",
      "restyle_page_images",
    ];

    for (const name of sideEffectTools) {
      expect(toolRegistry.get(name)?.requiresConfirmation, name).toBe(true);
    }
  });

  it("should throw on unknown tool execution", async () => {
    await expect(
      toolRegistry.execute("nonexistent_tool", {}, {
        project: null,
        userMessage: "",
        agentCtx: {
          projectId: "test",
          scratch: {},
          providers: { llm: {} as never, image: {} as never, visionCritic: false },
        },
      })
    ).rejects.toThrow("未知工具");
  });
});
