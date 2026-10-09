import { describe, expect, it, vi } from "vitest";
import type { AssetDesignSpec } from "@/lib/project/design-spec-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { heuristicStatesForRegion, inferRegionStates } from "./infer-states";

const project = {
  id: "p",
  title: "Acme",
  rawIdea: "weekly planner",
  brief: {
    productName: "Acme",
    positioning: "Plan your week",
    targetUser: "makers",
    platform: "web",
  },
} as unknown as ProjectFile;

function spec(regions: AssetDesignSpec["regions"]): AssetDesignSpec {
  return {
    version: 1,
    assetId: "a",
    summary: "Dashboard",
    screenType: "dashboard",
    layout: "",
    hierarchy: [],
    regions,
    tokens: { colors: [], typography: [], radii: [], spacingHints: [] },
    components: [],
    doNot: [],
    implementationNotes: [],
    source: "vision",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function llmReturning(text: string): LlmProvider {
  return {
    name: "test-llm",
    generateText: vi.fn(async () => ({ text })),
  } as unknown as LlmProvider;
}

describe("heuristicStatesForRegion", () => {
  it("gives interactive roles the states a static mockup cannot show", () => {
    const cta = heuristicStatesForRegion({ id: "c", name: "CTA", role: "cta" }).map((s) => s.name);
    expect(cta).toEqual(["default", "hover", "focus-visible", "disabled", "loading"]);
    const form = heuristicStatesForRegion({ id: "f", name: "Search", role: "form" }).map(
      (s) => s.name,
    );
    expect(form).toContain("error");
    expect(form).toContain("empty");
    expect(heuristicStatesForRegion({ id: "x", name: "Footer", role: "footer" })).toHaveLength(1);
  });
});

describe("inferRegionStates", () => {
  it("skips when there are no code regions", async () => {
    const out = await inferRegionStates({
      spec: spec([{ id: "hero", name: "Hero", role: "hero", delivery: "media" }]),
      project,
    });
    expect(out.source).toBe("none");
    expect(out.spec.regions[0].states).toBeUndefined();
  });

  it("falls back to rules without an LLM and leaves media regions alone", async () => {
    const out = await inferRegionStates({
      spec: spec([
        { id: "cta", name: "CTA", role: "cta", copy: "Start free" },
        { id: "hero", name: "Hero", role: "hero", delivery: "media" },
      ]),
      project,
    });
    expect(out.source).toBe("heuristic");
    expect(out.spec.regions[0].states?.map((s) => s.name)).toContain("loading");
    expect(out.spec.regions[1].states).toBeUndefined();
  });

  it("prefers LLM states, fills missing notes from rules and keeps baseline error/empty states", async () => {
    const llm = llmReturning(
      JSON.stringify({
        regions: [
          {
            id: "list",
            states: [
              { name: "populated", notes: "Rows as shown." },
              {
                name: "empty",
                notes: "Centered illustration + one button.",
                copy: "还没有任务，先添加本周的第一件事",
              },
              { name: "loading", notes: "" },
            ],
          },
          { id: "ghost", states: [{ name: "x", notes: "should be ignored" }] },
        ],
      }),
    );
    const out = await inferRegionStates({
      spec: spec([{ id: "list", name: "Task list", role: "main", copy: "本周任务" }]),
      project,
      llm,
    });
    expect(out.source).toBe("llm");
    const states = out.spec.regions[0].states ?? [];
    const byName = Object.fromEntries(states.map((s) => [s.name, s]));
    expect(byName.empty.copy).toBe("还没有任务，先添加本周的第一件事");
    // 空 notes 用规则补
    expect(byName.loading.notes).toMatch(/Skeleton/);
    // LLM 漏掉的 error 从规则里补回
    expect(byName.error).toBeDefined();
    // 不存在的 region 不会被凭空加上
    expect(out.spec.regions.find((r) => r.id === "ghost")).toBeUndefined();
    expect(llm.generateText).toHaveBeenCalledTimes(1);
  });

  it("keeps rule-based states when the LLM output is garbage", async () => {
    const out = await inferRegionStates({
      spec: spec([{ id: "cta", name: "CTA", role: "cta" }]),
      project,
      llm: llmReturning("sorry, cannot help"),
    });
    expect(out.source).toBe("heuristic");
    expect(out.warnings[0]).toMatch(/unparseable/);
    expect(out.spec.regions[0].states?.length).toBeGreaterThan(0);
  });
});
