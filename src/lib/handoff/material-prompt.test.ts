import { describe, expect, it } from "vitest";
import {
  composeMaterialGenerationPrompt,
  formatArtStyleLock,
  formatStyleDna,
  materialNegativePrompt,
  sanitizeMood,
} from "./material-prompt";

const dnaLock = {
  palette: ["#7C3AED", "#111"],
  mood: "Dark, gritty industrial-style login page for the game asset platform",
  materials: "",
  doNot: ["UI chrome"],
  summary:
    "Top header bar, full-width category tab strip, left fixed filter sidebar",
  dna: {
    finish: "brushed steel",
    lighting: "neon rim light",
    texture: "cross-hatch metal",
    edge: "thin neon edge",
    accent: "#7C3AED",
  },
};

describe("composeMaterialGenerationPrompt", () => {
  it("refine mode anchors on crop ground truth and skips page mood", () => {
    const composed = composeMaterialGenerationPrompt({
      slotPrompt:
        "Cyberpunk city street at night, narrow alley with glowing neon signs",
      role: "illustration",
      genMode: "refine",
      styleLock: {
        ...dnaLock,
        mood: "dark neon",
      },
      outputSpec: { alpha: false, tileable: false, bleed: 0.02 },
    });

    expect(composed).toContain("SUBJECT CROP");
    expect(composed).toContain("ground truth");
    expect(composed).toContain("Subject hint: Cyberpunk city street");
    expect(composed).toContain("Style DNA:");
    expect(composed).toContain("brushed steel");
    expect(composed).toContain("Palette: #7C3AED, #111");
    expect(composed).not.toContain("Mood:");
    expect(composed).not.toContain("Top header bar");
    expect(composed).not.toContain("login page");
  });

  it("regenerate keeps short mood for illustration and isolation tail", () => {
    const composed = composeMaterialGenerationPrompt({
      slotPrompt:
        "Cyberpunk city street at night, narrow alley with glowing neon signs",
      role: "illustration",
      genMode: "regenerate",
      styleLock: {
        ...dnaLock,
        mood: "dark neon",
      },
    });

    expect(composed).toContain("Cyberpunk city street");
    expect(composed).toContain("Mood: dark neon");
    expect(composed).toContain("isolated subject only");
    expect(composed).toContain("optional style hints");
  });

  it("refine for background asks for full mockup recovery", () => {
    const composed = composeMaterialGenerationPrompt({
      slotPrompt: "seamless dark industrial metal wall texture",
      role: "background",
      genMode: "refine",
      styleLock: {
        ...dnaLock,
        mood: "dark neon",
      },
      outputSpec: { alpha: false, tileable: true, bleed: 0.02 },
    });
    expect(composed).toContain("FULL approved mockup");
    expect(composed).toContain("seamless reusable background");
    expect(composed).not.toContain("SUBJECT CROP");
    expect(composed).toContain("seamless tileable");
  });

  it("refine for icon keeps DNA, drops polluted mood", () => {
    const composed = composeMaterialGenerationPrompt({
      slotPrompt:
        "GitHub Octocat silhouette logo in white, isolated on transparent background",
      role: "icon",
      genMode: "refine",
      styleLock: dnaLock,
      outputSpec: { alpha: true, tileable: false, bleed: 0.01 },
    });

    expect(composed).toContain("GitHub Octocat silhouette");
    expect(composed).toContain("Style DNA:");
    expect(composed).toContain("neon rim light");
    expect(composed).toContain("Flat or silhouette mark");
    expect(composed).toContain("prefer transparent");
    expect(composed).not.toContain("Mood:");
    expect(composed).not.toContain("login page");
  });

  it("does not double-append isolation on regenerate when already present", () => {
    const composed = composeMaterialGenerationPrompt({
      slotPrompt: "Icon set, transparent background, isolated subject only.",
      role: "icon",
      genMode: "regenerate",
      styleLock: {
        palette: [],
        mood: "",
        materials: "",
        doNot: [],
        summary: "layout junk",
        dna: {
          finish: "",
          lighting: "",
          texture: "",
          edge: "",
          accent: "",
        },
      },
    });
    expect(composed.match(/isolated subject only/gi)?.length).toBe(1);
    expect(composed).not.toContain("layout junk");
  });
});

describe("sanitizeMood / formatArtStyleLock / DNA", () => {
  it("drops long page-like mood but keeps DNA", () => {
    expect(sanitizeMood(dnaLock.mood)).toBe("");
    const formatted = formatArtStyleLock(dnaLock, {
      role: "illustration",
      genMode: "regenerate",
    });
    expect(formatted).not.toContain("Mood:");
    expect(formatted).toContain("Style DNA:");
    expect(formatted).toContain("Palette:");
  });

  it("keeps short mood only for regenerate non-atomic roles", () => {
    expect(
      formatArtStyleLock(
        {
          palette: ["#fff"],
          mood: "clean neon",
          materials: "glass",
          doNot: [],
          summary: "3-column grid",
          dna: {
            finish: "matte glass",
            lighting: "",
            texture: "",
            edge: "",
            accent: "",
          },
        },
        { role: "hero", genMode: "regenerate" }
      )
    ).toContain("Mood: clean neon");
    expect(
      formatArtStyleLock(
        {
          palette: ["#fff"],
          mood: "clean neon",
          materials: "",
          doNot: [],
          summary: "",
          dna: {
            finish: "matte glass",
            lighting: "",
            texture: "",
            edge: "",
            accent: "",
          },
        },
        { role: "hero", genMode: "refine" }
      )
    ).not.toContain("Mood:");
    expect(
      formatArtStyleLock(
        {
          palette: ["#fff"],
          mood: "clean neon",
          materials: "",
          doNot: [],
          summary: "",
          dna: {
            finish: "",
            lighting: "",
            texture: "",
            edge: "",
            accent: "#fff",
          },
        },
        { role: "icon", genMode: "regenerate" }
      )
    ).not.toContain("Mood:");
  });

  it("formats DNA compactly", () => {
    expect(
      formatStyleDna({
        finish: "steel",
        lighting: "neon",
        texture: "",
        edge: "",
        accent: "#7C3AED",
      })
    ).toBe("Style DNA: finish steel; lighting neon; accent #7C3AED.");
  });

  it("builds stronger negative for atomic + refine", () => {
    expect(materialNegativePrompt("icon")).toContain("login form");
    expect(materialNegativePrompt("icon")).toContain("scene environment");
    expect(materialNegativePrompt("hero")).not.toContain("scene environment");
    expect(materialNegativePrompt("icon", "refine")).toContain(
      "redesigned composition"
    );
  });
});
