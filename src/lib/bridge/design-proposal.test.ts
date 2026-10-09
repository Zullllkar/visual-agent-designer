import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { LayoutIR } from "@/lib/handoff/layout-ir";
import {
  applyProposalToProject,
  describeProposal,
  type DesignProposalInput,
} from "./design-proposal";

function asset(id: string, extra: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id,
    prompt: `mockup ${id}`,
    src: "data:image/png;base64,AAAA",
    width: 1440,
    height: 900,
    model: "m",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "starred",
    ...extra,
  };
}

function layoutFor(id: string): LayoutIR {
  return {
    version: 1,
    mockupAssetId: id,
    width: 1440,
    height: 900,
    referenceImage: `assets/final/mockup-${id}.png`,
    nodes: [
      {
        id: "hero",
        parentAssetId: id,
        role: "hero",
        bbox: { x: 0.05, y: 0.1, w: 0.9, h: 0.4 },
        rebuildInCode: false,
        prompt: "hero art",
        status: "ready",
        materialAssetId: `${id}-hero`,
        media: `assets/materials/${id}/hero.png`,
      },
      {
        id: "cta",
        role: "cta",
        bbox: { x: 0.4, y: 0.55, w: 0.2, h: 0.06 },
        rebuildInCode: true,
        copy: "Start free",
        copySource: "plan",
        media: null,
      },
    ],
  };
}

function projectWithLayout(id = "screen-1"): ProjectFile {
  return {
    id: "p1",
    slug: "p1",
    title: "Acme",
    rawIdea: "Acme visual project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    assets: [asset(id)],
    materializations: {
      [id]: {
        mockupAssetId: id,
        layout: layoutFor(id),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  } as ProjectFile;
}

const visionSpec = (id: string) =>
  ({
    version: 1,
    assetId: id,
    summary: "Landing",
    screenType: "landing",
    layout: "",
    hierarchy: [],
    regions: [],
    tokens: { colors: [], typography: [], radii: [], spacingHints: [] },
    components: [],
    doNot: [],
    implementationNotes: ["Keep the hero photographic"],
    copyPlan: [],
    unplacedCopy: [],
    source: "vision",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as NonNullable<ImageAsset["designSpec"]>;

describe("describeProposal", () => {
  it("summarizes each change kind in one line", () => {
    const base = { assetId: "screen-1", rationale: "too long for the button" };
    expect(
      describeProposal({ ...base, change: { kind: "copy", slotId: "cta", copy: "Go" } })
    ).toContain('Change copy of "cta" to "Go"');
    expect(
      describeProposal({
        ...base,
        change: { kind: "bbox", slotId: "hero", bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
      })
    ).toMatch(/Move \/ resize "hero"/);
    expect(
      describeProposal({ ...base, change: { kind: "convert-to-code", slotId: "hero" } })
    ).toContain("Build");
    expect(describeProposal({ ...base, change: { kind: "remove-slot", slotId: "hero" } })).toContain(
      "Remove region"
    );
    expect(
      describeProposal({
        ...base,
        change: { kind: "add-state", slotId: "cta", state: { name: "hover", notes: "lighten" } },
      })
    ).toContain('Add state "hover"');
    expect(describeProposal({ ...base, change: { kind: "note", text: "stack on mobile" } })).toBe(
      "Note: stack on mobile"
    );
  });
});

describe("applyProposalToProject", () => {
  it("updates copy on a code region and keeps the original project intact", () => {
    const project = projectWithLayout();
    const input: DesignProposalInput = {
      assetId: "screen-1",
      rationale: "CTA overflows at 320px",
      change: { kind: "copy", slotId: "cta", copy: "Start" },
    };
    const result = applyProposalToProject(project, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cta = result.project.materializations?.["screen-1"]?.layout.nodes.find((n) => n.id === "cta");
    expect(cta?.rebuildInCode).toBe(true);
    if (cta?.rebuildInCode === true) {
      expect(cta.copy).toBe("Start");
      expect(cta.copySource).toBe("plan");
      expect(cta.copyObserved).toBe("Start free");
      expect(cta.notes).toMatch(/CTA overflows/);
    }
    const original = project.materializations?.["screen-1"]?.layout.nodes.find((n) => n.id === "cta");
    expect(original && original.rebuildInCode === true ? original.copy : undefined).toBe("Start free");
  });

  it("rejects copy on a media region", () => {
    const result = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "want caption on the photo",
      change: { kind: "copy", slotId: "hero", copy: "caption" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/media region/);
  });

  it("moves a slot and clamps bbox so it stays inside 0–1", () => {
    const result = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "hero should sit higher",
      change: { kind: "bbox", slotId: "hero", bbox: { x: 0.8, y: 0.8, w: 0.5, h: 0.5 } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hero = result.project.materializations?.["screen-1"]?.layout.nodes.find((n) => n.id === "hero");
    expect(hero?.bbox).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
  });

  it("converts a media slot to a code region", () => {
    const result = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "CSS gradient is cheaper than a bitmap",
      change: { kind: "convert-to-code", slotId: "hero" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hero = result.project.materializations?.["screen-1"]?.layout.nodes.find((n) => n.id === "hero");
    expect(hero?.rebuildInCode).toBe(true);
    if (hero?.rebuildInCode === true) {
      expect(hero.media).toBeNull();
      expect(hero.notes).toMatch(/CSS gradient/);
    }
  });

  it("refuses convert-to-code when the slot is already code", () => {
    const result = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "already code",
      change: { kind: "convert-to-code", slotId: "cta" },
    });
    expect(result.ok).toBe(false);
  });

  it("removes a region from the layout", () => {
    const result = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "decoration is unused",
      change: { kind: "remove-slot", slotId: "hero" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.project.materializations?.["screen-1"]?.layout.nodes.map((n) => n.id);
    expect(ids).toEqual(["cta"]);
  });

  it("adds a named state to a code region", () => {
    const result = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "need a disabled CTA",
      change: {
        kind: "add-state",
        slotId: "cta",
        state: { name: "disabled", notes: "40% opacity", copy: "Start free" },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cta = result.project.materializations?.["screen-1"]?.layout.nodes.find((n) => n.id === "cta");
    expect(cta && cta.rebuildInCode === true ? cta.states : undefined).toEqual([
      { name: "disabled", notes: "40% opacity", copy: "Start free" },
    ]);
  });

  it("attaches a layout-wide note when there is no slotId", () => {
    const result = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "stack columns below 640px",
      change: { kind: "note", text: "Use a single column under 640px." },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.materializations?.["screen-1"]?.layout.meta?.warnings?.[0]).toMatch(
      /single column/
    );
  });

  it("attaches a note to the design spec when there is no Layout IR", () => {
    const project = {
      id: "p1",
      slug: "p1",
      title: "Acme",
      rawIdea: "Acme visual project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
      assets: [asset("screen-1", { designSpec: visionSpec("screen-1") })],
    } as ProjectFile;
    const result = applyProposalToProject(project, {
      assetId: "screen-1",
      rationale: "copy is too long for the button",
      change: { kind: "note", text: "Shorten CTA to two words." },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const notes = result.project.assets?.[0]?.designSpec?.implementationNotes ?? [];
    expect(notes.some((n) => n.includes("Shorten CTA"))).toBe(true);
  });

  it("rejects non-note changes before materialize", () => {
    const project = {
      id: "p1",
      slug: "p1",
      title: "Acme",
      rawIdea: "Acme visual project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pages: [],
      assets: [asset("screen-1")],
    } as ProjectFile;
    const result = applyProposalToProject(project, {
      assetId: "screen-1",
      rationale: "need shorter copy",
      change: { kind: "copy", slotId: "cta", copy: "Go" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no Layout IR/);
  });

  it("rejects unknown assets and unknown slots", () => {
    expect(
      applyProposalToProject(projectWithLayout(), {
        assetId: "missing",
        rationale: "n/a",
        change: { kind: "note", text: "hello" },
      }).ok
    ).toBe(false);
    const missingSlot = applyProposalToProject(projectWithLayout(), {
      assetId: "screen-1",
      rationale: "n/a",
      change: { kind: "remove-slot", slotId: "nope" },
    });
    expect(missingSlot.ok).toBe(false);
    if (missingSlot.ok) return;
    expect(missingSlot.error).toMatch(/Available: hero, cta/);
  });
});
