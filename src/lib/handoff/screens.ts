/**
 * 「屏」视图：把项目拆成 coding agent 一次能做完的单位
 * --------------------------------------------------------------
 * 一张可交付的整图 mockup = 一屏。这里只做纯计算：
 *   - 顺序：approved / 已物料化 / starred / 其他
 *   - 就绪度：有没有 Layout IR、素材齐不齐、有没有规格、色板是不是像素来源
 *   - 实现状态：最近一次 report_implementation 的结论
 *   - 单屏任务简报：给 agent 的"只做这一屏"说明
 *
 * 数据来源都在 ProjectFile + 实现报告里，读盘由调用方负责。
 */

import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import { countMediaSlots, countReadyMaterials, type LayoutIR } from "./layout-ir";
import { isCodingHandoffPack, resolveHandoffPackKind } from "./pack-kind";
import { listSelectableHandoffAssets } from "./select-assets";
import type { SharedComponentIndex } from "./shared-components";
import { displayAssetTitle } from "@/lib/project/asset-title";

/** 与 bridge/implementation-review 的 ImplementationReport 对齐的最小字段集 */
export interface ScreenReportLike {
  id: string;
  assetId?: string;
  score: number | null;
  verdict: "pass" | "needs-work" | "off-track" | "unreviewed";
  summary?: string;
  url?: string;
  createdAt: string;
  deviations: Array<{
    slot: string;
    kind: string;
    severity: "low" | "medium" | "high";
    expected: string;
    actual: string;
    fixHint: string;
  }>;
}

export type ScreenReadiness = "ready" | "partial" | "draft";

export interface ScreenSummary {
  assetId: string;
  /** 建议实现顺序，从 1 开始 */
  order: number;
  title: string;
  screenType?: string;
  width: number;
  height: number;
  status: {
    approval?: string;
    starred: boolean;
    materialized: boolean;
    mediaSlots: number;
    materialsReady: number;
    codeSlots: number;
    hasSpec: boolean;
    specSource?: "vision" | "heuristic";
    hasPixelPalette: boolean;
    copyPlanCount: number;
    unplacedCopyCount: number;
  };
  readiness: { level: ScreenReadiness; missing: string[] };
  implementation?: {
    reportId: string;
    verdict: ScreenReportLike["verdict"];
    score: number | null;
    deviations: number;
    highSeverity: number;
    reportedAt: string;
    url?: string;
  };
  files: { layout?: string; spec: string; materialsDir?: string };
}

export function listScreens(
  project: ProjectFile,
  reports: ScreenReportLike[] = [],
): ScreenSummary[] {
  const latestByAsset = latestReportByAsset(reports);
  const assets = [...listSelectableHandoffAssets(project)].sort(
    (a, b) =>
      rankAsset(project, a) - rankAsset(project, b) || a.createdAt.localeCompare(b.createdAt),
  );
  return assets.map((asset, index) =>
    summarizeScreen(project, asset, index + 1, latestByAsset.get(asset.id)),
  );
}

export function getScreen(
  project: ProjectFile,
  assetId: string,
  reports: ScreenReportLike[] = [],
): ScreenSummary | undefined {
  return listScreens(project, reports).find((s) => s.assetId === assetId);
}

function summarizeScreen(
  project: ProjectFile,
  asset: ImageAsset,
  order: number,
  report: ScreenReportLike | undefined,
): ScreenSummary {
  const coding = isCodingHandoffPack(resolveHandoffPackKind(project));
  const layout = project.materializations?.[asset.id]?.layout;
  const spec = asset.designSpec;
  const mediaSlots = layout ? countMediaSlots(layout) : 0;
  const materialsReady = layout ? countReadyMaterials(layout) : 0;
  const codeSlots = layout ? layout.nodes.filter((n) => n.rebuildInCode === true).length : 0;
  const hasPixelPalette = Boolean(spec?.tokens.colors.some((c) => c.source === "pixels"));

  const missing: string[] = [];
  let level: ScreenReadiness;

  if (!coding) {
    if (asset.status !== "starred") {
      missing.push(
        "Not starred — exploration candidate. Do not treat as a final for the art / media pack until the designer stars it.",
      );
    }
    level = asset.status === "starred" ? "ready" : "draft";
  } else {
    if (!layout)
      missing.push(
        'No Layout IR — the designer has not run "materialize" (拆成素材) on this mockup yet.',
      );
    if (layout && materialsReady < mediaSlots) {
      missing.push(
        `${mediaSlots - materialsReady} of ${mediaSlots} media slots have no generated material yet.`,
      );
    }
    if (!spec)
      missing.push("No design spec — regions and copy would have to be inferred from the image.");
    else if (spec.source === "heuristic")
      missing.push("Design spec is heuristic (no vision pass); bboxes are guesses.");
    if (spec && !hasPixelPalette)
      missing.push("Palette was not sampled from pixels; colors come from text only.");

    level =
      layout && materialsReady === mediaSlots && spec?.source === "vision"
        ? "ready"
        : layout || spec
          ? "partial"
          : "draft";
  }

  return {
    assetId: asset.id,
    order,
    title: screenTitle(asset),
    screenType: spec?.screenType,
    width: asset.width,
    height: asset.height,
    status: {
      approval: asset.approval?.status,
      starred: asset.status === "starred",
      materialized: Boolean(layout),
      mediaSlots,
      materialsReady,
      codeSlots,
      hasSpec: Boolean(spec),
      specSource: spec?.source,
      hasPixelPalette,
      copyPlanCount: asset.copyPlan?.length ?? spec?.copyPlan?.length ?? 0,
      unplacedCopyCount: spec?.unplacedCopy?.length ?? 0,
    },
    readiness: { level, missing },
    implementation: report
      ? {
          reportId: report.id,
          verdict: report.verdict,
          score: report.score,
          deviations: report.deviations.length,
          highSeverity: report.deviations.filter((d) => d.severity === "high").length,
          reportedAt: report.createdAt,
          url: report.url,
        }
      : undefined,
    files: {
      layout: layout ? `design/layouts/${asset.id}.json` : undefined,
      spec: `design/specs/${asset.id}.md`,
      materialsDir: layout && mediaSlots > 0 ? `assets/materials/${asset.id}/` : undefined,
    },
  };
}

/** 单屏任务简报（Markdown），给 agent 当这一屏的 task brief */
export function buildScreenTask(
  project: ProjectFile,
  screen: ScreenSummary,
  report: ScreenReportLike | undefined,
  total: number,
  shared?: SharedComponentIndex,
): string {
  if (!isCodingHandoffPack(resolveHandoffPackKind(project))) {
    return buildArtAssetTask(project, screen, total);
  }
  const asset = (project.assets ?? []).find((a) => a.id === screen.assetId);
  const layout = project.materializations?.[screen.assetId]?.layout;
  const spec = asset?.designSpec;
  const sharedHere = shared?.byScreen[screen.assetId] ?? {};
  const lines: string[] = [];

  lines.push(
    `# Screen ${screen.order}/${total}: ${screen.title}`,
    "",
    `Project: **${project.title}** — ${project.brief?.positioning ?? project.rawIdea}`,
    `Mockup asset: \`${screen.assetId}\` (${screen.width}×${screen.height}${screen.screenType ? `, ${screen.screenType}` : ""})`,
    `Platform: ${project.brief?.platform ?? "not specified"} · Visual style: ${project.brief?.visualStyle ?? "not specified"}`,
    "",
    "## Scope",
    "",
    "Implement **only this screen**. Do not build other screens or invent flows that are not in this mockup.",
    "Shared foundations (tokens, palette, DESIGN.md don'ts) apply to every screen — set them up once and reuse.",
    "",
  );

  lines.push("## Readiness", "", `Level: **${screen.readiness.level}**`);
  if (screen.readiness.missing.length) {
    for (const m of screen.readiness.missing) lines.push(`- ⚠ ${m}`);
    lines.push("", "If something above blocks you, call `ask_designer` instead of guessing.");
  } else {
    lines.push("- Layout IR, materials, vision spec and pixel palette are all present.");
  }
  lines.push("");

  lines.push("## Read (in this order)", "");
  lines.push("1. `DESIGN.md` — palette sampled from pixels, style lock, don'ts (shared)");
  if (screen.files.layout) {
    lines.push(
      `2. \`${screen.files.layout}\` — authoritative regions for this screen (or \`get_layout_ir("${screen.assetId}")\`)`,
    );
  }
  lines.push(
    `${screen.files.layout ? 3 : 2}. \`${screen.files.spec}\` — copy plan, swatches, implementation notes`,
  );
  if (screen.files.materialsDir) {
    lines.push(
      `${screen.files.layout ? 4 : 3}. \`${screen.files.materialsDir}\` — place these files for media regions (see MATERIAL_MAP.md)`,
    );
  }
  lines.push(
    `- View the mockup: \`get_asset_image("${screen.assetId}")\`; zoom into a region: \`get_asset_crop("${screen.assetId}", slotId)\`.`,
    "",
  );

  if (layout) {
    lines.push("## Regions", "");
    lines.push(renderRegionTable(layout, sharedHere));
    lines.push("");
  }

  const sharedUsed =
    shared?.components.filter((c) => Object.values(sharedHere).includes(c.id)) ?? [];
  if (sharedUsed.length) {
    lines.push("## Shared components on this screen (build once, reuse)", "");
    for (const c of sharedUsed) {
      const mine = c.instances
        .filter((i) => i.assetId === screen.assetId)
        .map((i) => `\`${i.nodeId}\``);
      const others = c.screenCount - 1;
      lines.push(
        `- **${c.name}** ← ${mine.join(", ")} · also on ${others} other screen${others === 1 ? "" : "s"}. ${c.notes}`,
      );
    }
    lines.push(
      "",
      "See `COMPONENTS.md` / `design/components.json` for every instance and copy variant.",
      "",
    );
  }

  const plan = asset?.copyPlan ?? spec?.copyPlan ?? [];
  if (plan.length) {
    lines.push("## Copy (authoritative)", "");
    for (const c of plan) lines.push(`- **${c.role}**: ${c.text}`);
    lines.push("");
  }
  if (spec?.unplacedCopy?.length) {
    lines.push("Planned copy the image did not render — still required:", "");
    for (const c of spec.unplacedCopy) lines.push(`- **${c.role}**: ${c.text}`);
    lines.push("");
  }

  const statefulNodes = (layout?.nodes ?? []).filter(
    (n): n is Extract<LayoutIR["nodes"][number], { rebuildInCode: true }> =>
      n.rebuildInCode === true && Boolean(n.states?.length),
  );
  if (statefulNodes.length) {
    lines.push("## States to implement (the mockup only shows the default)", "");
    for (const node of statefulNodes) {
      lines.push(`- \`${node.id}\` (${node.role}):`);
      for (const s of node.states ?? []) {
        lines.push(`  - **${s.name}** — ${s.notes}${s.copy ? ` Copy: "${s.copy}"` : ""}`);
      }
    }
    lines.push("");
  }

  if (spec?.implementationNotes?.length) {
    lines.push("## Notes from the spec", "");
    for (const n of spec.implementationNotes.slice(0, 8)) lines.push(`- ${n}`);
    lines.push("");
  }

  lines.push("## Acceptance", "");
  lines.push(
    `1. When the screen renders in your dev server, call \`report_implementation({ assetId: "${screen.assetId}", url: "<your dev url>", summary: "..." })\`. The Vibeboard desktop app screenshots it and diffs against this mockup.`,
    "2. Fix every `high` deviation, then report again. Stop when verdict is `pass` or the user accepts the remaining items.",
    "3. Media regions must show the material files, not CSS/SVG recreations. Text must be real DOM text using the copy above.",
    "",
  );

  if (report) {
    lines.push("## Last review of this screen", "");
    lines.push(
      `- ${report.createdAt} · verdict **${report.verdict}**${report.score !== null ? ` · ${report.score}/10` : ""}${report.url ? ` · ${report.url}` : ""}`,
    );
    if (report.summary) lines.push(`- ${report.summary}`);
    const open = report.deviations.filter((d) => d.severity !== "low");
    if (open.length) {
      lines.push("", "Open deviations to fix first:", "");
      for (const d of open.slice(0, 10)) {
        lines.push(
          `- [${d.severity}] ${d.slot || "(screen)"} · ${d.kind}: expected ${d.expected}; got ${d.actual}. → ${d.fixHint}`,
        );
      }
    } else if (report.verdict === "pass") {
      lines.push("- This screen already passed review. Only touch it if the design changed.");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildArtAssetTask(project: ProjectFile, screen: ScreenSummary, total: number): string {
  const pack = resolveHandoffPackKind(project);
  const kind =
    pack === "art-bible" ? "art bible" : pack === "media-pack" ? "media pack" : "style exploration pack";
  const asset = (project.assets ?? []).find((a) => a.id === screen.assetId);
  const lines = [
    `# Asset ${screen.order}/${total}: ${screen.title}`,
    "",
    `Project: **${project.title}** — ${project.brief?.positioning ?? project.rawIdea}`,
    `Pack: **${kind}** (\`${project.targetId ?? "unknown"}\`). This is **not** a UI screen to implement in code.`,
    `Asset: \`${screen.assetId}\` (${screen.width}×${screen.height}${asset?.role ? `, role ${asset.role}` : ""})`,
    `Status: ${screen.status.starred ? "starred final" : "exploration candidate"}`,
    "",
    "## What to do",
    "",
    "- Look at the image with `get_asset_image(\"" + screen.assetId + "\")`.",
    "- Read `ART_BIBLE.md` / `ASSET_USAGE.md` (or `COPY.md` / `STYLE_NOTES.md`) from `get_handoff`.",
    "- Do **not** call `report_implementation`, `get_layout_ir`, or `propose_design_change`. There is no Layout IR.",
    "- Do **not** invent a React/app screen from this painting.",
    "",
  ];
  if (!screen.status.starred) {
    lines.push(
      "## Not a final",
      "",
      "The designer has not starred this asset. Treat it as exploration. Ask them to star the shots that belong in the pack before using them as production art.",
      "",
    );
  }
  if (asset?.prompt) {
    lines.push("## Prompt / intended use", "", asset.prompt.trim(), "");
  }
  return lines.join("\n");
}

function renderRegionTable(layout: LayoutIR, shared: Record<string, string> = {}): string {
  const rows = [
    "| id | role | build | bbox (x,y,w,h) | copy / media | swatch | component |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const node of layout.nodes) {
    const bbox = `${pct(node.bbox.x)} ${pct(node.bbox.y)} ${pct(node.bbox.w)} ${pct(node.bbox.h)}`;
    const swatch = node.swatch
      ? `${node.swatch.dominant}${node.swatch.accent ? ` / ${node.swatch.accent}` : ""}`
      : "";
    const component = shared[node.id] ? `shared: \`${shared[node.id]}\`` : "";
    if (node.rebuildInCode === false) {
      rows.push(
        `| \`${node.id}\` | ${node.role} | media | ${bbox} | \`${node.media ?? "(material pending)"}\` | ${swatch} | |`,
      );
    } else {
      const copy = node.copy
        ? `"${node.copy.slice(0, 60)}"${node.copySource === "vision" ? " (ocr)" : ""}`
        : "";
      rows.push(
        `| \`${node.id}\` | ${node.role} | code | ${bbox} | ${copy} | ${swatch} | ${component} |`,
      );
    }
  }
  return rows.join("\n");
}

export function latestReportByAsset(reports: ScreenReportLike[]): Map<string, ScreenReportLike> {
  const map = new Map<string, ScreenReportLike>();
  for (const r of reports) {
    if (!r.assetId) continue;
    const prev = map.get(r.assetId);
    if (!prev || r.createdAt > prev.createdAt) map.set(r.assetId, r);
  }
  return map;
}

function rankAsset(project: ProjectFile, a: ImageAsset): number {
  if (!isCodingHandoffPack(resolveHandoffPackKind(project))) {
    return a.status === "starred" ? 0 : 1;
  }
  if (a.approval?.status === "approved" || a.approval?.status === "materials_ready") return 0;
  if (project.materializations?.[a.id]) return 1;
  if (a.status === "starred") return 2;
  return 3;
}

const GENERIC_ROLES = new Set(["hero", "other", "illustration"]);

export function screenTitle(asset: ImageAsset): string {
  const spec = asset.designSpec;
  const fromSummary = spec?.summary?.trim();
  if (fromSummary && fromSummary.length <= 60) return fromSummary;
  if (spec?.screenType && spec.screenType !== "other") return humanize(spec.screenType);
  if (asset.role && !GENERIC_ROLES.has(asset.role)) return humanize(asset.role);
  return displayAssetTitle(asset);
}

function humanize(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
