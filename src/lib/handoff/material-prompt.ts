/**
 * 媒体槽生图提示词：按 genMode 切换策略。
 * - slice: 不调用模型（由 generate-materials 直接用 crop）
 * - refine: 像素锚定提纯（content crop 为主）
 * - regenerate: 文字重绘（少用）
 */

import type { MaterialSlot, StyleDna, StyleLock } from "./layout-ir";
import type { MaterialGenMode, MaterialOutputSpec } from "./material-gen-mode";

const ISOLATION_TAIL =
  "Transparent or solid clean background; isolated subject only. No UI chrome, no full-page mockup, no illegible text.";

const ATOMIC_ROLES = new Set<MaterialSlot["role"]>([
  "icon",
  "avatar",
  "decoration",
]);

const PAGE_MOOD_NOISE =
  /\b(page|login|sidebar|header|footer|navbar|layout|screen|dashboard|card grid|pagination|toolbar|mockup|整页|登录|侧栏)\b/i;

const ROLE_TEMPLATE: Partial<Record<MaterialSlot["role"], string>> = {
  icon: "Flat or silhouette mark, single glyph-like subject, no scene environment.",
  avatar: "Centered portrait subject, clean crop, no UI chrome.",
  decoration: "Small ornamental accent, isolated, no text.",
  hero: "Full illustrative subject matching the locked art style.",
  illustration: "Standalone illustration matching the locked art style.",
  background: "Seamless atmospheric background texture, no UI chrome.",
};

export const MATERIAL_NEGATIVE_PROMPT =
  "UI chrome, login form, text fields, buttons, navigation bar, sidebar, full-page mockup, illegible text, watermark, multiple panels, screenshot of an app";

export function formatArtStyleLock(
  lock?: StyleLock | null,
  opts?: { role?: MaterialSlot["role"] | string; genMode?: MaterialGenMode }
): string {
  if (!lock) return "";
  const role = opts?.role as MaterialSlot["role"] | undefined;
  const atomic = role ? ATOMIC_ROLES.has(role) : false;
  const mood = sanitizeMood(lock.mood);
  const dna = formatStyleDna(lock.dna);
  // refine：弱化 mood，强调 DNA；regenerate 才带 mood
  const includeMood =
    opts?.genMode === "regenerate" && !atomic && Boolean(mood);
  return [
    dna,
    includeMood ? `Mood: ${mood}` : "",
    lock.palette?.length ? `Palette: ${lock.palette.slice(0, 5).join(", ")}` : "",
    lock.doNot?.length
      ? `Avoid: ${lock.doNot.slice(0, 4).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function formatStyleDna(dna?: StyleDna | null): string {
  if (!dna) return "";
  const bits = [
    dna.finish ? `finish ${dna.finish}` : "",
    dna.lighting ? `lighting ${dna.lighting}` : "",
    dna.texture ? `texture ${dna.texture}` : "",
    dna.edge ? `edge ${dna.edge}` : "",
    dna.accent ? `accent ${dna.accent}` : "",
  ].filter(Boolean);
  if (!bits.length) return "";
  return `Style DNA: ${bits.join("; ")}.`;
}

function formatOutputSpec(spec?: MaterialOutputSpec | null): string {
  if (!spec) return "";
  const bits = [
    spec.alpha ? "prefer transparent background / alpha" : "",
    spec.tileable ? "seamless tileable texture" : "",
  ].filter(Boolean);
  return bits.length ? `Output: ${bits.join("; ")}.` : "";
}

export function composeMaterialGenerationPrompt(input: {
  slotPrompt: string;
  styleLock?: StyleLock | null;
  role?: MaterialSlot["role"] | string;
  genMode?: MaterialGenMode;
  outputSpec?: MaterialOutputSpec | null;
  includeIsolation?: boolean;
  includeRoleTemplate?: boolean;
}): string {
  const base = input.slotPrompt.trim();
  if (!base) return "";
  const mode = input.genMode ?? "refine";
  const role = input.role as MaterialSlot["role"] | undefined;

  if (mode === "refine") {
    return composeRefinePrompt({
      slotPrompt: base,
      styleLock: input.styleLock,
      role,
      outputSpec: input.outputSpec,
    });
  }

  // regenerate（及未识别 mode）
  const parts: string[] = [base];
  if (input.includeRoleTemplate !== false && role && ROLE_TEMPLATE[role]) {
    const tpl = ROLE_TEMPLATE[role]!;
    if (!containsLoose(base, tpl.slice(0, 24))) parts.push(tpl);
  }
  const art = formatArtStyleLock(input.styleLock, {
    role: input.role,
    genMode: "regenerate",
  });
  if (art && !containsLoose(base, art.slice(0, 40))) parts.push(art);
  const out = formatOutputSpec(input.outputSpec);
  if (out) parts.push(out);
  if (role === "background") {
    parts.push(
      "The first reference image is the FULL approved mockup — match its continuous background atmosphere; strip UI chrome; do not return a UI screenshot."
    );
  } else {
    if (
      input.includeIsolation !== false &&
      !containsLoose(base, "isolated subject") &&
      !containsLoose(base, "transparent") &&
      !containsLoose(base, "clean background")
    ) {
      parts.push(ISOLATION_TAIL);
    }
    parts.push(
      "Reference images are optional style hints only; invent a clean isolated asset, not a full UI page."
    );
  }
  return parts.join(" ");
}

function composeRefinePrompt(input: {
  slotPrompt: string;
  styleLock?: StyleLock | null;
  role?: MaterialSlot["role"];
  outputSpec?: MaterialOutputSpec | null;
}): string {
  if (input.role === "background") {
    return composeBackgroundRefinePrompt(input);
  }

  const parts = [
    "The first reference image is the SUBJECT CROP from the approved mockup — treat it as ground truth for silhouette, content, and composition.",
    "Clean and isolate this subject into a reusable material asset.",
    "Do not invent a different layout, scene, or full-page UI.",
    "Remove surrounding UI chrome, form fields, and illegible text.",
    input.slotPrompt ? `Subject hint: ${input.slotPrompt}` : "",
  ];
  if (input.role && ROLE_TEMPLATE[input.role]) {
    parts.push(ROLE_TEMPLATE[input.role]!);
  }
  const art = formatArtStyleLock(input.styleLock, {
    role: input.role,
    genMode: "refine",
  });
  if (art) parts.push(art);
  const out = formatOutputSpec(input.outputSpec);
  if (out) parts.push(out);
  else parts.push(ISOLATION_TAIL);
  parts.push(
    "If a second reference is provided, use it only for materials/lighting/palette — never copy full-page structure."
  );
  return parts.filter(Boolean).join(" ");
}

/** 背景槽：参考整张 mockup，抽出可复用底图/纹理 */
function composeBackgroundRefinePrompt(input: {
  slotPrompt: string;
  styleLock?: StyleLock | null;
  role?: MaterialSlot["role"];
  outputSpec?: MaterialOutputSpec | null;
}): string {
  const parts = [
    "The first reference image is the FULL approved mockup page — use it as ground truth for the continuous background surface, perspective, and atmosphere.",
    "Recover a seamless reusable background plate / texture that matches the mockup.",
    "Remove foreground UI chrome: navigation, forms, buttons, cards, text overlays, and illegible glyphs.",
    "Do not return a screenshot of the UI; output only the background environment.",
    input.slotPrompt ? `Background hint: ${input.slotPrompt}` : "",
  ];
  if (input.role && ROLE_TEMPLATE[input.role]) {
    parts.push(ROLE_TEMPLATE[input.role]!);
  }
  const art = formatArtStyleLock(input.styleLock, {
    role: input.role,
    genMode: "refine",
  });
  if (art) parts.push(art);
  const out = formatOutputSpec(input.outputSpec);
  if (out) parts.push(out);
  return parts.filter(Boolean).join(" ");
}

export function materialNegativePrompt(
  role?: MaterialSlot["role"] | string,
  genMode?: MaterialGenMode
): string {
  const atomic =
    role === "icon" || role === "avatar" || role === "decoration";
  const extra = atomic
    ? ", scene environment, deep perspective room, complex background illustration"
    : "";
  const refineExtra =
    genMode === "refine"
      ? ", redesigned composition, alternate subject, different logo"
      : "";
  return MATERIAL_NEGATIVE_PROMPT + extra + refineExtra;
}

export function sanitizeMood(mood?: string | null): string {
  const raw = (mood ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  if (raw.length > 72) return "";
  if (PAGE_MOOD_NOISE.test(raw)) return "";
  if (/[.。;；]/.test(raw) && raw.length > 40) return "";
  return raw.slice(0, 72);
}

function containsLoose(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().slice(0, 48);
  return n.length > 0 && h.includes(n);
}
