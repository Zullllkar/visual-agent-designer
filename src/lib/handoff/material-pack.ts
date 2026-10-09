/**
 * Handoff 打包：materials + Layout IR + DESIGN/SKILL/MATERIAL_MAP/assembly
 */

import type { HandoffArtifact } from "./types";
import type { ProjectFile } from "@/lib/project/schema";
import type { ImageAsset } from "@/lib/project/assets-schema";
import {
  countMediaSlots,
  countReadyMaterials,
  type LayoutIR,
  type MaterializationRecord,
  type StyleDna,
} from "./layout-ir";
import { pickPrimaryMockup } from "./select-assets";
import { buildSharedComponentIndex, renderComponentsMd } from "./shared-components";

type FileEntry = HandoffArtifact["files"][number];

interface MaterialEntry {
  mockupId: string;
  slotId: string;
  path: string;
  asset: ImageAsset;
}

export async function appendMaterializationFiles(
  project: ProjectFile,
  files: FileEntry[],
  materializeImage: (
    src: string
  ) => Promise<{ content: string | Uint8Array; ext: string } | null>,
  warnings: string[]
): Promise<{
  materialCount: number;
  layoutCount: number;
  readyMockups: string[];
}> {
  const records = Object.values(project.materializations ?? {});
  if (records.length === 0) {
    return { materialCount: 0, layoutCount: 0, readyMockups: [] };
  }

  const assetById = new Map((project.assets ?? []).map((a) => [a.id, a]));
  const materialEntries: MaterialEntry[] = [];
  const layouts: LayoutIR[] = [];
  const readyMockups: string[] = [];

  for (const record of records) {
    const layout = withResolvedMediaPaths(record.layout, assetById);
    layouts.push(layout);
    files.push({
      path: `design/layouts/${record.mockupAssetId}.json`,
      content: JSON.stringify(layout, null, 2),
    });

    if (countReadyMaterials(layout) > 0) {
      readyMockups.push(record.mockupAssetId);
    }

    for (const node of layout.nodes) {
      if (node.rebuildInCode !== false) continue;
      const packPath =
        node.media ??
        `assets/materials/${record.mockupAssetId}/${node.id}.png`;

      if (node.materialAssetId) {
        const asset = assetById.get(node.materialAssetId);
        if (asset?.src) {
          materialEntries.push({
            mockupId: record.mockupAssetId,
            slotId: node.id,
            path: packPath,
            asset,
          });
          continue;
        }
        warnings.push(
          `Material slot ${node.id} missing asset ${node.materialAssetId}`
        );
      }

      // 无独立素材资产时，回退槽位 crop（仍写入对应关系）
      if (node.cropPreviewSrc?.startsWith("data:image/")) {
        materialEntries.push({
          mockupId: record.mockupAssetId,
          slotId: node.id,
          path: packPath,
          asset: {
            id: `${node.id}-crop`,
            prompt: node.prompt,
            src: node.cropPreviewSrc,
            width: 0,
            height: 0,
            model: "crop-fallback",
            createdAt: record.updatedAt,
            status: "candidate",
            source: "materialized",
            parentAssetId: record.mockupAssetId,
            materialSlotId: node.id,
          },
        });
      } else if (!node.materialAssetId) {
        warnings.push(
          `Material slot ${node.id} has no materialAssetId and no cropPreviewSrc`
        );
      }
    }
  }

  files.push({
    path: "design/layouts/index.json",
    content: JSON.stringify(
      {
        count: layouts.length,
        layouts: layouts.map((l) => ({
          mockupAssetId: l.mockupAssetId,
          path: `design/layouts/${l.mockupAssetId}.json`,
          mediaSlots: countMediaSlots(l),
          readyMaterials: countReadyMaterials(l),
          screenType: l.screenType,
        })),
      },
      null,
      2
    ),
  });

  for (const entry of materialEntries) {
    const materialized = await materializeImage(entry.asset.src).catch(() => null);
    if (!materialized) {
      warnings.push(`Could not embed material ${entry.path}`);
      files.push({
        path: `${entry.path}.url.txt`,
        content: entry.asset.src,
      });
      continue;
    }
    const path = entry.path.replace(/\.(png|jpg|jpeg|webp)$/i, "") + `.${materialized.ext}`;
    files.push({ path, content: materialized.content });
  }

  const primaryId = pickPrimaryMockup(project)?.id;
  const primary =
    records.find((r) => r.mockupAssetId === primaryId) ?? records[0];
  files.push(
    { path: "LAYOUT.md", content: renderLayoutMd(records) },
    { path: "MATERIAL_MAP.md", content: renderMaterialMapMd(records, assetById) },
    {
      path: "DESIGN.md",
      content: renderDesignMd(
        project,
        primary,
        assetById.get(primary.mockupAssetId)
      ),
    },
    {
      path: "skills/design-to-code/SKILL.md",
      content: renderDesignToCodeSkill(),
    },
    {
      path: "preview/assembly.html",
      content: renderAssemblyHtml(primary?.layout),
    }
  );

  // ≥2 屏物料化后才有跨屏归并的意义；单屏项目不写空文件
  if (records.length >= 2) {
    const shared = buildSharedComponentIndex(project);
    files.push(
      { path: "COMPONENTS.md", content: renderComponentsMd(shared) },
      { path: "design/components.json", content: JSON.stringify(shared, null, 2) }
    );
  }

  return {
    materialCount: materialEntries.length,
    layoutCount: layouts.length,
    readyMockups,
  };
}

function withResolvedMediaPaths(
  layout: LayoutIR,
  assetById: Map<string, ImageAsset>
): LayoutIR {
  return {
    ...layout,
    nodes: layout.nodes.map((node) => {
      if (node.rebuildInCode !== false) return node;
      const asset = node.materialAssetId
        ? assetById.get(node.materialAssetId)
        : undefined;
      const ext =
        asset &&
        (/jpeg/i.test(asset.src) || /\.jpe?g/i.test(asset.src))
          ? "jpg"
          : node.cropPreviewSrc && /jpeg/i.test(node.cropPreviewSrc)
            ? "jpg"
            : "png";
      const hasEmbed =
        Boolean(asset?.src) ||
        Boolean(node.cropPreviewSrc?.startsWith("data:image/"));
      if (!hasEmbed && !node.media) return node;
      return {
        ...node,
        media:
          node.media ??
          `assets/materials/${layout.mockupAssetId}/${node.id}.${ext}`,
      };
    }),
  };
}

function renderLayoutMd(records: MaterializationRecord[]): string {
  return [
    "# Layout IR",
    "",
    "Machine-readable layout for coding agents. Prefer `design/layouts/*.json` over guessing from the full mockup image.",
    "",
    "## Rules",
    "",
    "- `rebuildInCode: false` → use the `media` file path. Do **not** redraw with CSS/SVG.",
    "- `rebuildInCode: true` → implement with real UI components and `copy`.",
    "- `copySource: plan | prompt` → `copy` is the authoritative wording decided before the image was generated; use it verbatim. `copySource: vision` → the text was read off a generated image and may contain typos; treat it as a hint and prefer the brief / `design/specs/*.md` copyPlan.",
    "- `states[]` on a code node → every listed state (hover, focus, disabled, loading, empty, error, active…) must be implemented; `states[].copy` is the text to show in that state. The mockup only shows the default state.",
    "- `layoutHint.parentId` → nest under that node when present; honor `zIndex` / `order`.",
    "- `swatch.dominant` / `swatch.accent` → the region's actual fill / highlight color sampled from the mockup pixels. Use it for that region's background / border / emphasis instead of guessing from the image.",
    "- `assets/final/*` is visual truth for review only.",
    "",
    "## Files",
    "",
    ...records.map(
      (r) =>
        `- \`design/layouts/${r.mockupAssetId}.json\` — ${countMediaSlots(r.layout)} media / ${r.layout.nodes.length} nodes`
    ),
    "",
  ].join("\n");
}

function renderMaterialMapMd(
  records: MaterializationRecord[],
  assetById: Map<string, ImageAsset>
): string {
  const lines = [
    "# Material Map",
    "",
    "Independent materials generated from the approved mockup. Coding agents must reference these files for media regions.",
    "",
  ];
  for (const record of records) {
    lines.push(`## Mockup \`${record.mockupAssetId}\``, "");
    lines.push("| Slot | Role | File | Status | Prompt (short) |");
    lines.push("|---|---|---|---|---|");
    for (const node of record.layout.nodes) {
      if (node.rebuildInCode !== false) {
        lines.push(
          `| \`${node.id}\` | ${node.role} | _(code)_ | rebuildInCode | ${(node.copy ?? "").slice(0, 40)} |`
        );
        continue;
      }
      const asset = node.materialAssetId
        ? assetById.get(node.materialAssetId)
        : undefined;
      const hasCrop = Boolean(node.cropPreviewSrc?.startsWith("data:image/"));
      const cropNote =
        node.notes?.includes("crop fallback") ||
        (node.media?.startsWith("assets/slices/") ?? false) ||
        (hasCrop && !asset)
          ? " · crop fallback"
          : "";
      const statusNote = asset || hasCrop ? "" : " (missing)";
      lines.push(
        `| \`${node.id}\` | ${node.role} | \`${node.media ?? "—"}\` | ${node.status}${statusNote}${cropNote} | ${node.prompt.slice(0, 48)}… |`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderDesignMd(
  project: ProjectFile,
  primary?: MaterializationRecord,
  primaryAsset?: ImageAsset
): string {
  const lock = primary?.styleLock;
  const colors = renderPaletteLines(lock?.palette ?? [], primaryAsset);

  return [
    "---",
    `product: ${JSON.stringify(project.title)}`,
    "---",
    "",
    `# DESIGN.md — ${project.title}`,
    "",
    "## Intent",
    "",
    project.brief?.positioning ?? project.rawIdea ?? "Visual product UI",
    "",
    "## Style lock",
    "",
    lock?.summary || project.designDirection?.summary || "Follow approved mockup.",
    "",
    "### Style DNA",
    "",
    ...styleDnaLines(lock?.dna),
    "### Palette",
    "",
    colors,
    "",
    "## Don'ts",
    "",
    ...(lock?.doNot?.length
      ? lock.doNot.map((d) => `- ${d}`)
      : [
          "- Do not redraw hero/illustration/background/avatar with CSS or generative fill.",
          "- Do not use the full mockup PNG as the only background for the app.",
          "- Do not invent screens without a matching mockup + layout IR.",
        ]),
    "",
    "## Components",
    "",
    "- Implement chrome (nav, CTA, forms) in code with real text.",
    "- Place materials via `<img>` / background-image using paths in MATERIAL_MAP.md.",
    "",
    "## Acceptance checklist",
    "",
    "- Compare UI to `assets/final/*` (hierarchy / density / palette).",
    "- Media zones must use `assets/materials/*` (or note crop fallbacks in `assets/slices/*`).",
    "- CTA/nav/form text comes from Layout IR, not from the mockup bitmap.",
    "- Optional: open `preview/assembly.html` for bbox proof.",
    "",
  ].join("\n");
}

/**
 * 色板行：优先用 designSpec.tokens.colors 的语义名 + 来源（pixels 采样最可信），
 * 没有规格时回落到 style lock 的匿名 color-N。
 */
function renderPaletteLines(lockPalette: string[], asset?: ImageAsset): string {
  const named = asset?.designSpec?.tokens.colors ?? [];
  if (named.length > 0) {
    const pixel = named.filter((c) => c.source === "pixels");
    const rest = named.filter((c) => c.source !== "pixels");
    const lines: string[] = [];
    if (pixel.length) {
      lines.push(
        "Sampled from the approved mockup pixels (authoritative — use these exact values):",
        ""
      );
      for (const c of pixel) {
        const share =
          typeof c.share === "number"
            ? ` · ${Math.round(c.share * 100)}% of canvas`
            : "";
        lines.push(
          `- **${c.name}**: \`${c.value}\`${c.usage ? ` — ${c.usage}` : ""}${share}`
        );
      }
    }
    if (rest.length) {
      lines.push(
        "",
        pixel.length
          ? "Also mentioned by the design brief / vision pass (secondary, verify against pixels):"
          : "From the design brief / vision pass:",
        ""
      );
      for (const c of rest) {
        lines.push(
          `- ${c.name}: \`${c.value}\`${c.usage ? ` — ${c.usage}` : ""}${c.source ? ` _(source: ${c.source})_` : ""}`
        );
      }
    }
    return lines.join("\n");
  }
  if (lockPalette.length) {
    return lockPalette.map((c, i) => `- color-${i + 1}: ${c}`).join("\n");
  }
  return "- (see design/tokens.json)";
}

function renderDesignToCodeSkill(): string {
  return [
    "---",
    "name: design-to-code",
    "description: Implement UI from a Vibeboard handoff asset pack (mockup + materials + Layout IR).",
    "---",
    "",
    "# Design to Code (Vibeboard Handoff)",
    "",
    "## Read order",
    "",
    "1. DESIGN.md",
    "2. LAYOUT.md + design/layouts/*.json",
    "2b. COMPONENTS.md (when present) — regions shared by several screens; build each once",
    "3. MATERIAL_MAP.md",
    "4. assets/materials/* (use) and assets/final/* (compare)",
    "5. design/tokens.json (+ tokens.dtcg.json)",
    "6. preview/assembly.html (optional layout proof)",
    "",
    "## Hard rules",
    "",
    "- For every Layout IR node with `rebuildInCode: false`, reference `media` — never recreate that visual in CSS/SVG.",
    "- For `rebuildInCode: true`, use real components and the provided `copy`.",
    "- Trust `copy` when `copySource` is plan/prompt. When it is vision, the text is OCR from a generated image — fix obvious typos using the brief; never ship garbled text just because the PNG shows it.",
    "- Any `unplacedCopy` listed in `design/specs/*.md` is required UI text the image failed to render — include it.",
    "- Build every state listed under a code node's `states[]` (empty / loading / error / hover / disabled / active). A screen that only matches the mockup's default state is not done.",
    "- Colors come from DESIGN.md palette (sampled from pixels) and each node's `swatch`; do not eyeball hex values from the PNG.",
    "- Keep the approved mockup as acceptance reference, not as a single stretched background.",
    "- Stay within screens that have layouts/materials unless the user expands scope.",
    "",
    "## Acceptance",
    "",
    "1. Diff visually against `assets/final/*`.",
    "2. Confirm media slots load package materials (not regenerated art).",
    "3. Confirm code slots use real components + IR copy.",
    "",
  ].join("\n");
}

function styleDnaLines(dna?: StyleDna): string[] {
  if (!dna) return ["- (derive from approved mockup materials)", ""];
  const lines = [
    dna.finish ? `- finish: ${dna.finish}` : "",
    dna.lighting ? `- lighting: ${dna.lighting}` : "",
    dna.texture ? `- texture: ${dna.texture}` : "",
    dna.edge ? `- edge: ${dna.edge}` : "",
    dna.accent ? `- accent: ${dna.accent}` : "",
  ].filter(Boolean);
  if (!lines.length) return ["- (derive from approved mockup materials)", ""];
  return [...lines, ""];
}

function renderAssemblyHtml(layout?: LayoutIR): string {
  if (!layout) {
    return `<!doctype html><meta charset="utf-8"><title>Assembly</title><p>No layout yet.</p>`;
  }
  const blocks = layout.nodes
    .map((node) => {
      const left = (node.bbox.x * 100).toFixed(2);
      const top = (node.bbox.y * 100).toFixed(2);
      const width = (node.bbox.w * 100).toFixed(2);
      const height = (node.bbox.h * 100).toFixed(2);
      if (node.rebuildInCode === false && node.media) {
        return `<div class="slot" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"><img src="../${node.media}" alt="${node.id}"/></div>`;
      }
      return `<div class="slot code" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%">${node.rebuildInCode ? (node as { copy?: string }).copy ?? node.id : node.id}</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Assembly preview — ${layout.mockupAssetId}</title>
  <style>
    body{margin:0;background:#111;color:#eee;font:12px/1.4 system-ui}
    .stage{position:relative;width:min(100vw,${layout.width}px);aspect-ratio:${layout.width}/${layout.height};margin:24px auto;background:#222;outline:1px solid #444}
    .slot{position:absolute;overflow:hidden;box-sizing:border-box}
    .slot img{width:100%;height:100%;object-fit:cover;display:block}
    .slot.code{border:1px dashed #888;padding:4px;background:rgba(0,0,0,.35)}
    p{text-align:center;opacity:.7}
  </style>
</head>
<body>
  <p>Assembly proof (materials + IR). Not production code.</p>
  <div class="stage">
${blocks}
  </div>
</body>
</html>
`;
}
