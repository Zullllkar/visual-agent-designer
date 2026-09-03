import type { ProjectFile } from "@/lib/project/schema";
import type { AssetDesignSpec } from "@/lib/project/design-spec-schema";
import type { HandoffTarget } from "./types";
import { deriveDesignContext } from "@/lib/project/design-context";
import { resolveHandoffPackKind } from "./pack-kind";
import { briefDisplayFields } from "@/lib/targets/brief";
import { getTargetRecipe } from "@/lib/targets/catalog";
import { resolveTargetId } from "@/lib/targets/resolve";

function activeAssets(project: ProjectFile) {
  return (project.assets ?? []).filter(
    (asset) =>
      asset.status !== "discarded" &&
      asset.status !== "failed" &&
      asset.status !== "cancelled" &&
      asset.status !== "generating" &&
      asset.source !== "materialized"
  );
}

function readableAssetName(index: number, asset: { role?: string; width: number; height: number; prompt: string }) {
  const slug = (asset.role || asset.prompt || "visual")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "visual";
  return `assets/final/asset-${String(index).padStart(2, "0")}-${slug}-${asset.width}x${asset.height}.*`;
}

export function buildKickoffClipboardText(
  project: ProjectFile,
  target: HandoffTarget["name"] = "cursor"
): string {
  const pack = resolveHandoffPackKind(project);
  if (pack !== "code-kickoff") {
    return buildNonCodeClipboardText(project, pack);
  }
  const assets = activeAssets(project);
  const designContext = deriveDesignContext(project);
  const specs = assets.filter((a) => a.designSpec?.summary);
  const targetName =
    target === "cursor"
      ? "Cursor"
      : target === "claude-code"
        ? "Claude Code"
        : target === "codex"
          ? "Codex"
          : "coding agent";

  const materializationCount = Object.keys(project.materializations ?? {}).length;
  const readOrder = [
    "1. `DESIGN.md`",
    "2. `LAYOUT.md` + `design/layouts/*` (Layout IR — authoritative geometry)",
    "3. `MATERIAL_MAP.md` + `assets/materials/*` (independent parts — must reference)",
    "4. `skills/design-to-code/SKILL.md`",
    "5. `assets/final/*` (approved mockup — visual truth / acceptance only)",
    "6. `SPEC.md` / `ASSET_MAP.md` / `IMPLEMENTATION.md`",
    "7. `design/tokens.json` (+ `design/tokens.dtcg.json`)",
    ...(designContext ? ["8. `design/design-context.json`"] : []),
    ...(materializationCount > 0
      ? ["9. `preview/assembly.html` (optional layout proof)"]
      : []),
  ];

  const referenceCount = project.references?.length ?? 0;

  return [
    `Please implement **${project.title}** from this Vibeboard handoff package in ${targetName}.`,
    "",
    `Product positioning: ${project.brief?.positioning ?? project.rawIdea}`,
    `Target platform: ${project.brief?.platform ?? "not specified"}`,
    `Visual style: ${project.brief?.visualStyle ?? "not specified"}`,
    "",
    "## Delivery scope (authoritative)",
    "",
    `- Final visuals in this package: **${assets.length}** (see \`assets/final/*\` + \`ASSET_MAP.md\`).`,
    `- References in this package: **${referenceCount}** (optional style cues only).`,
    "- The product brief may mention additional screens/features. **Do not invent UI for screens without a matching final asset** unless the user explicitly expands scope.",
    "",
    "Read these files in order before coding:",
    "",
    ...readOrder,
    "",
    "Primary visual assets:",
    ...(assets.length
      ? assets.slice(0, 12).map((asset, index) => {
          const path = readableAssetName(index + 1, asset);
          const specHint = asset.designSpec
            ? ` → see \`design/specs/${asset.id}.md\` (${asset.designSpec.screenType})`
            : "";
          return `- ${path}${specHint}`;
        })
      : ["- No final image assets are present. Check `handoff-report.json` before implementing."]),
    "",
    ...(specs.length
      ? [
          "Design specs available:",
          ...specs.slice(0, 8).map(
            (a) =>
              `- \`${a.id}\`: ${a.designSpec!.summary} — layout: ${a.designSpec!.layout}`
          ),
          "",
        ]
      : [
          "No per-asset design specs yet. Prefer regenerating specs in Vibeboard (「生成规格」) before a high-stakes handoff; otherwise infer carefully from images + ASSET_MAP.",
          "",
        ]),
    "Implementation rules (three channels):",
    "",
    "- **Layout IR** (`design/layouts/*`): authoritative regions. `rebuildInCode:false` → use `media` file; `true` → real components + `copy`.",
    "- **Materials** (`assets/materials/*`): independent parts generated from the approved mockup. Never redraw hero/illustration/background/avatar in CSS/SVG.",
    "- **Final mockup** (`assets/final/*`): visual truth for acceptance only — do not stretch one PNG as the whole UI.",
    "- Follow `DESIGN.md` don'ts and `skills/design-to-code/SKILL.md`.",
    "- Use real code-rendered UI text, navigation, controls, and states.",
    "- Do not invent a different visual system; follow tokens + style lock.",
    "- Stay inside screens that have layouts/materials unless the user expands scope.",
    "- If materials are missing, inspect `handoff-report.json` / `MATERIAL_MAP.md` and ask before guessing.",
    "",
    "## Visual acceptance (no browser automation required)",
    "",
    "1. Side-by-side: implementation vs `assets/final/*` — hierarchy, density, color grade.",
    "2. Media regions should be recognizably the files under `assets/materials/*` (not a new invented illustration).",
    "3. Code chrome (nav/CTA/forms) uses real text from Layout IR `copy`, not baked pixels.",
    "4. Paths marked `assets/slices/*` are crop fallbacks — prefer regenerating those materials in Vibeboard if fidelity matters.",
    "5. Open `preview/assembly.html` optionally to verify bbox placement of materials.",
    "",
    materializationCount > 0
      ? `This package includes **${materializationCount}** materialization layout(s). Prefer materials + IR over guessing from the mockup alone.`
      : "No materialization layouts yet — if fidelity matters, re-export after running「拆成素材 / materialize_mockup」in Vibeboard.",
    "",
  ].join("\n");
}

export function buildSingleAssetPrompt(
  project: ProjectFile,
  asset: {
    id: string;
    prompt: string;
    role?: string;
    width: number;
    height: number;
    editInstruction?: string;
    designSpec?: AssetDesignSpec;
  }
): string {
  return [
    `Please implement the following visual asset for **${project.title}**.`,
    "",
    `Product positioning: ${project.brief?.positioning ?? project.rawIdea}`,
    `Visual style: ${project.brief?.visualStyle ?? "not specified"}`,
    "",
    `Asset ID: ${asset.id}`,
    `Size: ${asset.width}x${asset.height}`,
    asset.role ? `Role: ${asset.role}` : "",
    asset.designSpec
      ? `Screen type: ${asset.designSpec.screenType}\nLayout: ${asset.designSpec.layout}`
      : "",
    "",
    "Generation prompt:",
    "",
    "```text",
    asset.prompt,
    "```",
    asset.editInstruction
      ? `\nEdit instruction:\n\n\`\`\`text\n${asset.editInstruction}\n\`\`\``
      : "",
    "",
    "Use this asset as a visual reference. Keep implementation text and controls as real UI, not baked image text.",
    asset.designSpec
      ? "A structured design spec is attached below / in `design/specs/` — follow its regions, tokens, and do-not list."
      : "If a design spec is unavailable, infer structure carefully from the image and keep the visual system unchanged.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 关联仓库后的短 kickoff，给 Cursor 深链用（控制在 1800 字以内）。 */
export function buildRepoKickoffText(
  project: ProjectFile,
  mountDir = "design/vibeboard"
): string {
  const dir = mountDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const assets = activeAssets(project);
  return [
    `Please implement **${project.title}** from the Vibeboard design package already in this repo.`,
    "",
    `Read \`${dir}/README.md\` first, then DESIGN.md / LAYOUT.md / assets/final/*.`,
    `A \`vibeboard\` MCP server is also configured — call get_handoff / get_asset_image for live context.`,
    "",
    `Positioning: ${project.brief?.positioning ?? project.rawIdea}`,
    `Platform: ${project.brief?.platform ?? "not specified"}`,
    `Visual style: ${project.brief?.visualStyle ?? "not specified"}`,
    `Final mockups in this package: ${assets.length}. Do not invent screens without a matching asset.`,
    "",
    "Treat Layout IR as authoritative geometry. Rebuild text/controls in real UI; place materials for media regions.",
  ].join("\n");
}

function buildNonCodeClipboardText(
  project: ProjectFile,
  pack: ReturnType<typeof resolveHandoffPackKind>
): string {
  const targetId = resolveTargetId(project);
  const recipe = getTargetRecipe(targetId);
  const fields = project.brief
    ? briefDisplayFields(project.brief, targetId)
    : [];
  const kind =
    pack === "art-bible"
      ? "美术包"
      : pack === "media-pack"
        ? "投放素材包"
        : "风格草稿包";
  return [
    `${kind}：${project.title}（${recipe.label}）`,
    "",
    "这不是给 Cursor / Claude Code / Codex 的 UI 施工包。",
    pack === "none" ? "探索草稿，选定方向后再锁定正式目标。" : "",
    "",
    ...fields.map((field) => `- ${field.label}：${field.value}`),
    "",
    pack === "art-bible"
      ? "阅读 ART_BIBLE.md 与 ASSET_USAGE.md，图在 assets/final/。"
      : pack === "media-pack"
        ? "阅读 COPY.md 与 ASSET_USAGE.md，图在 assets/final/。"
        : "阅读 STYLE_NOTES.md，图在 assets/final/。",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
