import type { HandoffArtifact, HandoffTarget } from "./types";
import type { ProjectFile } from "@/lib/project/schema";
import type { AssetDesignSpec } from "@/lib/project/design-spec-schema";
import {
  deriveDesignContext,
  isPlaceholderColorTokens,
  summarizeDesignContext,
} from "@/lib/project/design-context";
import {
  buildHeuristicSpec,
  mergeSpecTokensIntoHandoffTokens,
  renderAssetDesignSpecMarkdown,
} from "@/lib/design-spec/spec-format";
import { buildKickoffClipboardText } from "./kickoff-prompt";
import { appendMaterializationFiles } from "./material-pack";
import { toDtcgTokens } from "./tokens-dtcg";
import { renderTailwindTokens, renderTokensCss } from "./tokens-export";
import { resolveHandoffPackKind, type HandoffPackKind } from "./pack-kind";
import { pickPrimaryMockup } from "./select-assets";
import { briefDisplayFields } from "@/lib/targets/brief";
import { getTargetRecipe } from "@/lib/targets/catalog";
import { resolveTargetId } from "@/lib/targets/resolve";

type AssetStatus = "included" | "remote_failed" | "unsupported" | "missing";

interface HandoffAssetEntry {
  id: string;
  index: number;
  kind: "final" | "reference";
  file?: string;
  urlFile?: string;
  status: AssetStatus;
  width: number;
  height: number;
  role?: string;
  source?: string;
  model?: string;
  prompt?: string;
  originalSrc: string;
  error?: string;
  starred?: boolean;
}

interface HandoffBuildState {
  finalAssets: HandoffAssetEntry[];
  references: HandoffAssetEntry[];
  warnings: string[];
}

interface MaterializedImage {
  content: string | Uint8Array;
  ext: string;
  mime: string;
  sourceType: "data" | "remote";
}

export function createHandoffTarget(
  name: HandoffTarget["name"]
): HandoffTarget {
  return {
    name,
    async build({ project, requestOrigin }) {
      return buildArtifact(project, name, requestOrigin);
    },
  };
}

async function buildArtifact(
  project: ProjectFile,
  target: HandoffTarget["name"],
  requestOrigin?: string
): Promise<HandoffArtifact> {
  const pack = resolveHandoffPackKind(project);
  if (pack !== "code-kickoff") {
    return buildNonCodeArtifact(project, pack, requestOrigin);
  }

  const files: HandoffArtifact["files"] = [];
  const designContext = deriveDesignContext(project);
  const state: HandoffBuildState = {
    finalAssets: [],
    references: [],
    warnings: [],
  };

  await appendFinalAssets(project, files, state, requestOrigin);
  await appendReferenceAssets(project, files, state, requestOrigin);

  const materialStats = await appendMaterializationFiles(
    project,
    files,
    async (src) => {
      const out = await materializeImage(src, requestOrigin).catch(() => null);
      return out ? { content: out.content, ext: out.ext } : null;
    },
    state.warnings
  );

  const designSpecs = collectDesignSpecs(project);
  appendDesignSpecFiles(files, designSpecs, state);

  const baseTokens = extractTokens(project);
  const tokens = mergeSpecTokensIntoHandoffTokens(
    baseTokens,
    designSpecs,
    pickPrimaryMockup(project)?.id
  );
  const specByAssetId = new Map(designSpecs.map((s) => [s.assetId, s]));
  // Kickoff / project.json 带上导出时补全的规格（含 heuristic），与 design/specs 一致
  const projectWithSpecs: ProjectFile = {
    ...project,
    assets: (project.assets ?? []).map((a) => {
      const spec = specByAssetId.get(a.id);
      return spec ? { ...a, designSpec: a.designSpec ?? spec } : a;
    }),
  };

  files.push(
    { path: "README.md", content: renderReadme(project, target, state, designSpecs) },
    { path: "SPEC.md", content: renderSpec(project, state, designSpecs) },
    { path: "IMPLEMENTATION.md", content: renderImplementation(project, state, designSpecs) },
    { path: "ASSET_MAP.md", content: renderAssetMap(project, state, designSpecs) },
    {
      path: "handoff-report.json",
      content: JSON.stringify(
        buildReport(project, target, state, designSpecs, materialStats),
        null,
        2
      ),
    },
    { path: "design/project.json", content: JSON.stringify(projectWithSpecs, null, 2) },
    { path: "design/tokens.json", content: JSON.stringify(tokens, null, 2) },
    {
      path: "design/tokens.dtcg.json",
      content: JSON.stringify(toDtcgTokens(tokens), null, 2),
    },
    { path: "design/tokens.css", content: renderTokensCss(tokens) },
    { path: "design/tailwind.tokens.cjs", content: renderTailwindTokens(tokens) },
    {
      path: "design/specs/index.json",
      content: JSON.stringify(
        {
          count: designSpecs.length,
          specs: designSpecs.map((s) => ({
            assetId: s.assetId,
            screenType: s.screenType,
            source: s.source,
            summary: s.summary,
            path: `design/specs/${s.assetId}.md`,
          })),
        },
        null,
        2
      ),
    },
    { path: "assets/manifest.json", content: JSON.stringify(buildAssetManifest(state), null, 2) },
    { path: "assets/model-runs.json", content: JSON.stringify(buildModelRuns(projectWithSpecs, state), null, 2) },
    { path: `prompts/${target}-kickoff.md`, content: renderKickoffPrompt(projectWithSpecs, target) }
  );

  if (project.brief) {
    files.push({
      path: "design/brief.json",
      content: JSON.stringify(project.brief, null, 2),
    });
  }
  if (project.designDirection) {
    files.push({
      path: "design/direction.json",
      content: JSON.stringify(project.designDirection, null, 2),
    });
  }
  if (designContext) {
    files.push({
      path: "design/design-context.json",
      content: JSON.stringify(designContext, null, 2),
    });
  }

  if (target === "cursor") {
    files.push({ path: ".cursorrules", content: renderCursorRules(project) });
  } else if (target === "claude-code") {
    files.push({ path: "CLAUDE.md", content: renderClaudeMd(project) });
  } else if (target === "codex") {
    files.push({ path: "AGENTS.md", content: renderAgentsMd(project) });
  }

  return { files };
}

async function buildNonCodeArtifact(
  project: ProjectFile,
  pack: HandoffPackKind,
  requestOrigin?: string
): Promise<HandoffArtifact> {
  const files: HandoffArtifact["files"] = [];
  const state: HandoffBuildState = {
    finalAssets: [],
    references: [],
    warnings: [],
  };

  await appendFinalAssets(project, files, state, requestOrigin);
  await appendReferenceAssets(project, files, state, requestOrigin);
  if (
    pack !== "none" &&
    state.finalAssets.length > 0 &&
    !state.finalAssets.some((asset) => asset.starred)
  ) {
    state.warnings.push("没有收藏定稿，包内图片均为探索候选，请勿当生产图。");
  }

  const targetId = resolveTargetId(project);
  const recipe = getTargetRecipe(targetId);
  const fields = project.brief
    ? briefDisplayFields(project.brief, targetId)
    : [];
  const card = recipe.directionCards.find(
    (item) => item.id === project.directionCardId
  );

  files.push({
    path: "README.md",
    content: renderNonCodeReadme(project, pack, recipe.label, state),
  });
  files.push({
    path: "ASSET_USAGE.md",
    content: renderAssetUsage(project, pack, state),
  });
  files.push({
    path: "handoff-report.json",
    content: JSON.stringify(
      {
        ok: state.finalAssets.some((asset) => asset.status === "included"),
        pack,
        targetId,
        projectId: project.id,
        generatedAt: new Date().toISOString(),
        codingKickoff: false,
        assets: {
          finalTotal: state.finalAssets.length,
          finalIncluded: state.finalAssets.filter((asset) => asset.status === "included")
            .length,
          referencesTotal: state.references.length,
        },
        warnings: state.warnings,
      },
      null,
      2
    ),
  });
  files.push({
    path: "assets/manifest.json",
    content: JSON.stringify(buildAssetManifest(state), null, 2),
  });

  if (project.brief) {
    files.push({
      path: "design/brief.json",
      content: JSON.stringify(project.brief, null, 2),
    });
  }
  if (project.designDirection) {
    files.push({
      path: "design/direction.json",
      content: JSON.stringify(project.designDirection, null, 2),
    });
  }

  if (pack === "art-bible") {
    files.push({
      path: "ART_BIBLE.md",
      content: renderArtBible(project, recipe.label, fields, card, state),
    });
  } else if (pack === "media-pack") {
    files.push({
      path: "COPY.md",
      content: renderCopySheet(project, targetId, fields, state),
    });
  } else {
    files.push({
      path: "STYLE_NOTES.md",
      content: renderStyleNotes(project, fields),
    });
  }

  return { files };
}

function renderNonCodeReadme(
  project: ProjectFile,
  pack: HandoffPackKind,
  targetLabel: string,
  state: HandoffBuildState
): string {
  const kindLabel =
    pack === "art-bible"
      ? "美术包"
      : pack === "media-pack"
        ? "投放素材包"
        : "风格草稿包";
  const draftNote =
    pack === "none"
      ? [
          "",
          "这是探索草稿，不是施工包。不要交给 Cursor / Claude Code / Codex 当 UI 实现材料。",
          "",
        ]
      : [
          "",
          "本包不是给 AI coding 工具的施工包，不含 React kickoff、Layout IR 或 design/specs。",
          "",
        ];
  return [
    `# ${project.title}`,
    "",
    `${kindLabel} · ${targetLabel}`,
    "",
    project.rawIdea || "",
    ...draftNote,
    "## 阅读顺序",
    "",
    pack === "art-bible"
      ? "1. `ART_BIBLE.md`  2. `ASSET_USAGE.md`  3. `assets/final/*`"
      : pack === "media-pack"
        ? "1. `COPY.md`  2. `ASSET_USAGE.md`  3. `assets/final/*`"
        : "1. `STYLE_NOTES.md`  2. `assets/final/*`",
    "",
    `定稿 ${state.finalAssets.filter((asset) => asset.status === "included").length}/${state.finalAssets.length}，参考 ${state.references.filter((asset) => asset.status === "included").length}/${state.references.length}。`,
    ...(state.warnings.length
      ? ["", "警告：", ...state.warnings.map((item) => `- ${item}`)]
      : []),
    "",
  ].join("\n");
}

function renderArtBible(
  project: ProjectFile,
  targetLabel: string,
  fields: Array<{ label: string; value: string }>,
  card:
    | { id: string; label: string; tokens: string[]; forbids: string[] }
    | undefined,
  state: HandoffBuildState
): string {
  const lines = [
    `# 美术设定 · ${project.title}`,
    "",
    `目标：${targetLabel}`,
    "",
  ];
  if (fields.length) {
    lines.push("## Brief", "");
    for (const field of fields) {
      lines.push(`- ${field.label}：${field.value}`);
    }
    lines.push("");
  }
  if (card) {
    lines.push("## 方向卡", "");
    lines.push(`- ${card.label} (\`${card.id}\`)`);
    if (card.tokens.length) lines.push(`- 关键词：${card.tokens.join("、")}`);
    if (card.forbids.length) lines.push(`- 禁止：${card.forbids.join("、")}`);
    lines.push("");
  } else if (project.designDirection) {
    lines.push("## 视觉方向", "");
    lines.push(project.designDirection.summary, "");
  }
  lines.push("## 资产", "");
  const starred = state.finalAssets.filter((asset) => asset.starred);
  const exploring = state.finalAssets.filter((asset) => !asset.starred);
  if (starred.length) {
    lines.push("### 定稿（已收藏）", "");
    for (const asset of starred) {
      const kind = inferArtKind(asset.role, asset.prompt);
      lines.push(
        `- ${asset.file ?? asset.id}：${kind} ${asset.width}x${asset.height}`
      );
    }
    lines.push("");
  }
  if (exploring.length) {
    lines.push("### 探索（未收藏，不当生产图）", "");
    for (const asset of exploring) {
      const kind = inferArtKind(asset.role, asset.prompt);
      lines.push(
        `- ${asset.file ?? asset.id}：${kind} ${asset.width}x${asset.height}`
      );
    }
    lines.push("");
  }
  if (!state.finalAssets.length) {
    lines.push("本包没有图。", "");
  }
  return lines.join("\n");
}

function renderCopySheet(
  project: ProjectFile,
  targetId: ReturnType<typeof resolveTargetId>,
  fields: Array<{ label: string; value: string }>,
  state: HandoffBuildState
): string {
  const lines = [`# 文案表 · ${project.title}`, ""];
  if (fields.length) {
    for (const field of fields) {
      lines.push(`- ${field.label}：${field.value}`);
    }
    lines.push("");
  }
  if (targetId === "social-cover") {
    const hook = project.brief?.slots?.hook || project.brief?.positioning;
    if (hook) {
      lines.push("## 标题 / 钩子", "", hook, "");
      lines.push("## 建议标签", "", "#封面 #开箱", "");
    }
  }
  if (targetId === "promo-kv") {
    const hook = project.brief?.slots?.hook;
    const must = project.brief?.slots?.mustType;
    if (hook) lines.push("## 卖点", "", hook, "");
    if (must) lines.push("## 必须上的字", "", must, "");
  }
  if (targetId === "product-shot") {
    lines.push("## 电商三件套", "", "- 主图", "- 卖点图", "- 场景图", "");
  }
  lines.push("## 配套图", "");
  for (const asset of state.finalAssets) {
    lines.push(`- ${asset.file ?? asset.id}  ${asset.width}x${asset.height}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderStyleNotes(
  project: ProjectFile,
  fields: Array<{ label: string; value: string }>
): string {
  const lines = [
    `# 风格草稿 · ${project.title}`,
    "",
    "draft / 探索。选定方向后再锁定到界面、原画或投放目标。",
    "",
  ];
  for (const field of fields) {
    lines.push(`- ${field.label}：${field.value}`);
  }
  if (project.rawIdea) {
    lines.push("", project.rawIdea);
  }
  lines.push("");
  return lines.join("\n");
}

function renderAssetUsage(
  project: ProjectFile,
  pack: HandoffPackKind,
  state: HandoffBuildState
): string {
  const lines = [`# 资产用途 · ${project.title}`, ""];
  if (!state.finalAssets.length) {
    lines.push("本包没有定稿图。", "");
    return lines.join("\n");
  }
  for (const asset of state.finalAssets) {
    lines.push(`## ${asset.index}. ${asset.file ?? asset.id}`, "");
    lines.push(`- 尺寸：${asset.width}x${asset.height}`);
    if (asset.role) lines.push(`- 角色：${asset.role}`);
    lines.push(`- 状态：${asset.starred ? "已收藏定稿" : "探索候选，不当生产图"}`);
    lines.push(`- 用途：${usageForNonCodeAsset(pack, asset.role, asset.prompt, project)}`);
    if (asset.prompt) {
      lines.push("", "Prompt:", "", "```text", asset.prompt, "```");
    }
    lines.push("");
  }
  if (state.references.length) {
    lines.push("## 参考", "");
    for (const ref of state.references) {
      lines.push(`- ${ref.file ?? ref.id} ${ref.width}x${ref.height}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function inferArtKind(role: string | undefined, prompt: string | undefined): string {
  const p = `${role ?? ""} ${prompt ?? ""}`.toLowerCase();
  if (role === "scene" || /office|interior|street|city|environment|skyline|场景|街景|办公室/.test(p)) {
    return "场景";
  }
  if (role === "prop" || /prop sheet|道具|whiteboard|laptop with/.test(p)) return "道具";
  if (role === "icon") return "图标";
  if (/gameplay|hud|popup|playable|经营模拟/.test(p)) return "玩法关键帧";
  if (/character|founder|立绘|full body|portrait/.test(p) || role === "portrait") return "角色立绘";
  if (/meeting|pitch|investor|路演/.test(p)) return "剧情镜头";
  return "概念图";
}

function usageForNonCodeAsset(
  pack: HandoffPackKind,
  role: string | undefined,
  prompt: string | undefined,
  project: ProjectFile
): string {
  if (pack === "art-bible") {
    const kind = inferArtKind(role, prompt);
    if (kind === "场景") return "场景 / 镜头，保持同一世界观与光色";
    if (kind === "道具") return "道具表，剪影清楚，可单独切片";
    if (kind === "图标") return "图标 / 界面装饰，不要画成 SaaS 首页";
    if (kind === "玩法关键帧") return "玩法气氛图，不是可实现的 UI 线框";
    if (kind === "剧情镜头") return "叙事镜头，服务世界观而非界面";
    return "角色立绘 / 概念图，主体剪影清楚";
  }
  if (pack === "media-pack") {
    const shot = project.brief?.slots?.shot;
    if (shot === "white") return "白底主图，外形以参考为准";
    if (shot === "lifestyle") return "生活场景图";
    if (shot === "macro") return "材质特写";
    const channel = project.brief?.slots?.channel;
    if (channel === "story") return "9:16 竖版投放";
    if (channel === "square") return "1:1 方图";
    if (channel === "set") return "多尺寸套装中的一张";
    if (project.brief?.slots?.platform === "xhs") return "小红书竖版封面";
    return "投放主视觉 / 封面";
  }
  return "风格探索草稿，不当最终成稿";
}

async function appendFinalAssets(
  project: ProjectFile,
  files: HandoffArtifact["files"],
  state: HandoffBuildState,
  requestOrigin?: string
) {
  const assets = activeAssets(project);
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const baseName = assetBaseName("asset", i + 1, asset.role, asset.prompt, asset.width, asset.height);
    const materialized = await materializeImage(asset.src, requestOrigin).catch((error: Error) => {
      state.warnings.push(`Asset ${asset.id} could not be downloaded: ${error.message}`);
      return null;
    });

    const entry: HandoffAssetEntry = {
      id: asset.id,
      index: i + 1,
      kind: "final",
      status: "missing",
      width: asset.width,
      height: asset.height,
      role: asset.role,
      source: asset.source,
      model: asset.model,
      prompt: asset.prompt,
      originalSrc: asset.src,
      error: asset.error,
      starred: asset.status === "starred",
    };

    if (materialized) {
      const file = `assets/final/${baseName}.${materialized.ext}`;
      files.push({ path: file, content: materialized.content });
      entry.file = file;
      entry.status = "included";
    } else if (isRemoteLike(asset.src)) {
      const urlFile = `assets/final/${baseName}.url.txt`;
      files.push({ path: urlFile, content: asset.src });
      entry.urlFile = urlFile;
      entry.status = "remote_failed";
      entry.error = entry.error ?? "Image URL could not be embedded; see .url.txt";
    } else {
      entry.status = "unsupported";
      entry.error = entry.error ?? "Image source is not a supported data URL or fetchable URL.";
    }

    state.finalAssets.push(entry);
  }
}

async function appendReferenceAssets(
  project: ProjectFile,
  files: HandoffArtifact["files"],
  state: HandoffBuildState,
  requestOrigin?: string
) {
  const references = project.references ?? [];
  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    const baseName = assetBaseName("reference", i + 1, undefined, ref.label, ref.width, ref.height);
    const materialized = await materializeImage(ref.src, requestOrigin).catch((error: Error) => {
      state.warnings.push(`Reference ${ref.id} could not be downloaded: ${error.message}`);
      return null;
    });

    const entry: HandoffAssetEntry = {
      id: ref.id,
      index: i + 1,
      kind: "reference",
      status: "missing",
      width: ref.width,
      height: ref.height,
      source: ref.source,
      prompt: ref.notes ?? ref.label,
      originalSrc: ref.src,
    };

    if (materialized) {
      const file = `assets/references/${baseName}.${materialized.ext}`;
      files.push({ path: file, content: materialized.content });
      entry.file = file;
      entry.status = "included";
    } else if (isRemoteLike(ref.src)) {
      const urlFile = `assets/references/${baseName}.url.txt`;
      files.push({ path: urlFile, content: ref.src });
      entry.urlFile = urlFile;
      entry.status = "remote_failed";
      entry.error = "Reference URL could not be embedded; see .url.txt";
    } else {
      entry.status = "unsupported";
      entry.error = "Reference source is not a supported data URL or fetchable URL.";
    }

    state.references.push(entry);
  }
}

async function materializeImage(
  src: string,
  requestOrigin?: string
): Promise<MaterializedImage | null> {
  if (!src) return null;
  const data = decodeDataUrl(src);
  if (data) return data;

  const url = resolveFetchableUrl(src, requestOrigin);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = normalizeMime(res.headers.get("content-type")) ?? mimeFromUrl(src) ?? "image/png";
  if (!mime.startsWith("image/")) {
    throw new Error(`URL did not return an image (${mime})`);
  }
  const content = new Uint8Array(await res.arrayBuffer());
  return {
    content,
    ext: extensionFromMime(mime) ?? extensionFromUrl(src) ?? "png",
    mime,
    sourceType: "remote",
  };
}

function resolveFetchableUrl(src: string, requestOrigin?: string): string | null {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/") && requestOrigin) {
    return new URL(src, requestOrigin).toString();
  }
  return null;
}

function decodeDataUrl(src: string): MaterializedImage | null {
  const match = src.match(/^data:([^,;]+)((?:;[^,]+)*),(.*)$/);
  if (!match) return null;
  const mime = normalizeMime(match[1]) ?? "image/png";
  const meta = match[2] ?? "";
  const payload = match[3] ?? "";
  const ext = extensionFromMime(mime) ?? "png";
  if (meta.includes(";base64")) {
    const bin =
      typeof atob !== "undefined"
        ? atob(payload)
        : Buffer.from(payload, "base64").toString("binary");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { content: bytes, ext, mime, sourceType: "data" };
  }
  return {
    content: decodeURIComponent(payload),
    ext,
    mime,
    sourceType: "data",
  };
}

function collectDesignSpecs(project: ProjectFile): AssetDesignSpec[] {
  const assets = activeAssets(project);
  return assets.map((asset) => {
    if (asset.designSpec) return asset.designSpec;
    // Handoff always ships a structural middle layer; heuristic if user skipped「生成规格」
    return buildHeuristicSpec(asset, project);
  });
}

function appendDesignSpecFiles(
  files: HandoffArtifact["files"],
  specs: AssetDesignSpec[],
  state: HandoffBuildState
) {
  const byId = new Map(state.finalAssets.map((e) => [e.id, e]));
  for (const spec of specs) {
    const entry = byId.get(spec.assetId);
    files.push({
      path: `design/specs/${spec.assetId}.md`,
      content: renderAssetDesignSpecMarkdown(spec, {
        file: entry?.file ?? entry?.urlFile,
        prompt: entry?.prompt,
      }),
    });
    files.push({
      path: `design/specs/${spec.assetId}.json`,
      content: JSON.stringify(spec, null, 2),
    });
  }
}

function renderReadme(
  project: ProjectFile,
  target: HandoffTarget["name"],
  state: HandoffBuildState,
  designSpecs: AssetDesignSpec[]
): string {
  const b = project.brief;
  return [
    `# ${project.title}`,
    "",
    "This is a structured Vibeboard handoff package for implementation in Cursor, Claude Code, Codex, or another coding agent.",
    "",
    "## Read Order",
    "",
    "1. `SPEC.md` - product and feature requirements.",
    "2. `ASSET_MAP.md` - exact image assets and how to use them.",
    "3. `IMPLEMENTATION.md` - implementation plan, constraints, and acceptance checks.",
    "4. `design/specs/*` - per-asset structure, tokens, components (middle layer; not HTML).",
    "5. `design/tokens.json` / `design/tokens.dtcg.json` and `design/design-context.json` - visual system data.",
    "6. `assets/final/*` - final generated visual references.",
    "",
    "## Project Summary",
    "",
    `- Product: ${b?.productName ?? project.title}`,
    `- Positioning: ${b?.positioning ?? project.rawIdea}`,
    `- Target users: ${b?.targetUser ?? "Not specified"}`,
    `- Platform: ${b?.platform ?? "Not specified"}`,
    `- Visual style: ${b?.visualStyle ?? "Not specified"}`,
    `- Export target: ${target}`,
    `- Design specs: ${designSpecs.length} (vision=${designSpecs.filter((s) => s.source === "vision").length}, heuristic=${designSpecs.filter((s) => s.source === "heuristic").length})`,
    "",
    "## Package Structure",
    "",
    "```text",
    "README.md",
    "SPEC.md",
    "IMPLEMENTATION.md",
    "ASSET_MAP.md",
    "handoff-report.json",
    "design/",
    "  brief.json",
    "  direction.json",
    "  design-context.json",
    "  tokens.json",
    "  specs/",
    "    index.json",
    "    <assetId>.md",
    "    <assetId>.json",
    "assets/",
    "  final/          # generated images to use as primary visual references",
    "  references/     # user supplied references",
    "  manifest.json   # machine-readable asset manifest",
    "  model-runs.json # prompt/model/run metadata",
    "prompts/",
    "```",
    "",
    "## Asset Health",
    "",
    `- Final assets in package: ${state.finalAssets.filter((a) => a.status === "included").length}/${state.finalAssets.length}`,
    `- Reference assets in package: ${state.references.filter((a) => a.status === "included").length}/${state.references.length}`,
    `- Design specs: ${designSpecs.length}`,
    ...(state.warnings.length ? ["", "Warnings:", ...state.warnings.map((w) => `- ${w}`)] : []),
    "",
  ].join("\n");
}

function renderSpec(
  project: ProjectFile,
  state: HandoffBuildState,
  designSpecs: AssetDesignSpec[]
): string {
  const b = project.brief;
  const designContext = deriveDesignContext(project);
  const lines: string[] = [];
  lines.push(`# ${project.title} - Product Specification`, "");
  lines.push("## 1. Product", "");
  lines.push(`Original idea: ${project.rawIdea || project.title}`, "");
  if (b) {
    lines.push(`- Product name: ${b.productName}`);
    lines.push(`- Positioning: ${b.positioning}`);
    lines.push(`- Target users: ${b.targetUser}`);
    lines.push(`- Platform: ${b.platform}`);
    lines.push(`- Visual style: ${b.visualStyle}`);
    lines.push("");
    lines.push("### Core Features", "");
    b.coreFeatures.forEach((feature) => lines.push(`- ${feature}`));
    lines.push("", "### Key Scenarios", "");
    b.scenarios.forEach((scenario) => lines.push(`- ${scenario}`));
    lines.push("");
  }

  if (project.designDirection) {
    lines.push("## 2. Visual Direction", "");
    lines.push(project.designDirection.summary, "");
    if (project.designDirection.moodKeywords.length) {
      lines.push(`Mood keywords: ${project.designDirection.moodKeywords.join(", ")}`, "");
    }
  }

  if (designContext) {
    lines.push("## 3. Design Memory", "");
    lines.push("Use `design/design-context.json` as the source of truth for visual consistency.", "");
    lines.push("```text");
    lines.push(summarizeDesignContext(designContext));
    lines.push("```", "");
  }

  lines.push("## 4. Delivery Scope", "");
  lines.push(
    `This handoff package includes **${state.finalAssets.length}** selected final visual(s) and **${state.references.length}** reference(s).`
  );
  lines.push(
    "The product brief may describe additional screens or features that are **out of scope** for this package. Implement only what is backed by `assets/final/*` and `design/specs/*` unless the user expands scope."
  );
  lines.push("");

  lines.push("## 5. Visual Assets", "");
  lines.push(
    `${state.finalAssets.length} final asset(s) are listed in ASSET_MAP.md. Use them as the primary source for layout, color, visual hierarchy, illustration style, and UI direction.`
  );
  lines.push("");
  state.finalAssets.forEach((asset) => {
    lines.push(`- ${asset.file ?? asset.urlFile ?? asset.id}: ${asset.width}x${asset.height}${asset.role ? `, ${asset.role}` : ""}`);
  });
  lines.push("");

  lines.push("## 6. Design Specs (structure middle layer)", "");
  lines.push(
    "Per-asset specs live in `design/specs/`. They describe layout, regions, tokens, and components — not HTML source. Prefer vision-extracted specs from Vibeboard「生成规格」."
  );
  lines.push("");
  for (const spec of designSpecs) {
    lines.push(
      `- \`${spec.assetId}\` (${spec.source}/${spec.screenType}): ${spec.summary} — see \`design/specs/${spec.assetId}.md\``
    );
  }
  lines.push("");

  lines.push("## 7. Implementation Requirements", "");
  lines.push("- Do not treat this package as a canvas JSON reconstruction task.");
  lines.push("- Implement the product experience described here, using `assets/final/*` as visual references.");
  lines.push("- Follow `design/specs/*` for IA, component inventory, and token hints before inventing structure.");
  lines.push("- Preserve the visual direction, color logic, density, and component hierarchy from the generated images.");
  lines.push("- Use real UI text and accessible components in code; do not bake dynamic UI text into images unless the image itself is the reference.");
  lines.push("- Stay inside Delivery Scope: do not invent screens that have no matching final asset.");
  lines.push("- If assets are missing, read `handoff-report.json` before proceeding.");
  return lines.join("\n");
}

function renderImplementation(
  project: ProjectFile,
  state: HandoffBuildState,
  designSpecs: AssetDesignSpec[]
): string {
  const b = project.brief;
  return [
    `# Implementation Plan - ${project.title}`,
    "",
    "## Goal",
    "",
    `Build the ${b?.platform ?? "target"} experience for ${b?.productName ?? project.title}.`,
    "",
    "## Required Inputs",
    "",
    "- `SPEC.md` for product requirements.",
    "- `ASSET_MAP.md` for asset usage.",
    "- `design/specs/*` for per-asset layout / regions / components / tokens.",
    "- `assets/final/*` for generated UI/visual references.",
    "- `design/tokens.json` for reusable visual tokens (merged from brief + specs).",
    "- `design/design-context.json` if present.",
    "",
    "## Execution Steps",
    "",
    "1. Inspect every image in `assets/final/` before writing UI code.",
    "2. Open the matching `design/specs/<assetId>.md` and lock IA + component inventory.",
    "3. Identify the primary screen or visual state from `ASSET_MAP.md`.",
    "4. Build the real UI with code-rendered text, controls, navigation, and layout.",
    "5. Use generated images as references or embedded visual assets only where appropriate.",
    "6. Match spacing, hierarchy, palette, and density from specs + images; do not invent a new visual system.",
    "7. Verify desktop/mobile or target-platform dimensions before finalizing.",
    "",
    "## Spec coverage",
    "",
    `- Specs in package: ${designSpecs.length}`,
    `- Vision-extracted: ${designSpecs.filter((s) => s.source === "vision").length}`,
    `- Heuristic fallback: ${designSpecs.filter((s) => s.source === "heuristic").length}`,
    "",
    "## Acceptance Checks",
    "",
    `- All final assets are accounted for: ${state.finalAssets.filter((a) => a.status === "included").length}/${state.finalAssets.length}.`,
    "- The implementation references the correct assets from `ASSET_MAP.md`.",
    "- Regions/components from `design/specs/*` are reflected (or consciously deferred with a note).",
    "- The UI does not become a marketing poster unless the asset is explicitly a poster.",
    "- The first screen communicates the product category and core workflow.",
    "- Text is real, readable UI copy in the implementation.",
    "",
  ].join("\n");
}

function renderAssetMap(
  project: ProjectFile,
  state: HandoffBuildState,
  designSpecs: AssetDesignSpec[]
): string {
  void project;
  const specById = new Map(designSpecs.map((s) => [s.assetId, s]));
  const lines: string[] = [];
  lines.push(`# Asset Map - ${project.title}`, "");
  lines.push("Use this file to decide how each generated image should influence implementation.", "");

  if (!state.finalAssets.length) {
    lines.push("No final generated assets are available in this handoff.");
  }

  for (const asset of state.finalAssets) {
    const spec = specById.get(asset.id);
    lines.push(`## ${asset.index}. ${asset.file ?? asset.urlFile ?? asset.id}`, "");
    lines.push(`- Status: ${asset.status}`);
    lines.push(`- Size: ${asset.width}x${asset.height}`);
    if (asset.role) lines.push(`- Role: ${asset.role}`);
    if (asset.model) lines.push(`- Model: ${asset.model}`);
    lines.push(`- Use for: ${usageForAsset(asset)}`);
    if (spec) {
      lines.push(`- Design spec: \`design/specs/${asset.id}.md\` (${spec.source}, ${spec.screenType})`);
      lines.push(`- Layout: ${spec.layout}`);
      if (spec.regions.length) {
        lines.push(
          `- Regions: ${spec.regions.map((r) => `${r.name}/${r.role}`).join(", ")}`
        );
      }
    }
    lines.push("- Do not: replace the visual direction with a generic template or unrelated marketing layout.");
    if (asset.error) lines.push(`- Warning: ${asset.error}`);
    if (asset.prompt) {
      lines.push("", "Prompt:", "", "```text", asset.prompt, "```");
    }
    lines.push("");
  }

  if (state.references.length) {
    lines.push("# References", "");
    for (const ref of state.references) {
      lines.push(`- ${ref.file ?? ref.urlFile ?? ref.id}: ${ref.width}x${ref.height}, status ${ref.status}`);
    }
  }

  return lines.join("\n");
}

function renderCursorRules(project: ProjectFile): string {
  return [
    `# ${project.title} - Cursor Rules`,
    "",
    "Read `SPEC.md`, `ASSET_MAP.md`, `IMPLEMENTATION.md`, and `design/specs/*` before editing code.",
    "Inspect `assets/final/*` and preserve the visual direction shown there.",
    "Use `design/tokens.json` and `design/design-context.json` when present.",
    "Treat design specs as structure/tokens guidance — not as HTML to paste.",
    "Do not treat this as a raw project data dump. Build the actual user-facing product UI.",
    "",
  ].join("\n");
}

function renderClaudeMd(project: ProjectFile): string {
  return [
    "# CLAUDE.md",
    "",
    `You are implementing ${project.title} from a Vibeboard handoff package.`,
    "",
    "Read order:",
    "1. SPEC.md",
    "2. ASSET_MAP.md",
    "3. IMPLEMENTATION.md",
    "4. design/specs/*",
    "5. assets/final/*",
    "6. design/tokens.json and design/design-context.json",
    "",
  ].join("\n");
}

function renderAgentsMd(project: ProjectFile): string {
  return [
    "# AGENTS.md",
    "",
    `This repository/package describes ${project.title}.`,
    "",
    "Required reading before implementation:",
    "- SPEC.md",
    "- ASSET_MAP.md",
    "- IMPLEMENTATION.md",
    "- design/specs/*",
    "- assets/final/*",
    "- design/tokens.json",
    "",
    "Keep the generated image assets as the primary visual reference. Use design specs for structure. Do not invent a different UI style.",
    "",
  ].join("\n");
}

function renderKickoffPrompt(
  project: ProjectFile,
  target: HandoffTarget["name"]
): string {
  const label =
    target === "cursor"
      ? "Cursor"
      : target === "claude-code"
        ? "Claude Code"
        : target === "codex"
          ? "Codex"
          : "Coding Agent";

  return [
    `# ${label} Kickoff Prompt`,
    "",
    buildKickoffClipboardText(project, target),
    "",
  ].join("\n");
}

function buildReport(
  project: ProjectFile,
  target: HandoffTarget["name"],
  state: HandoffBuildState,
  designSpecs: AssetDesignSpec[],
  materialStats?: {
    materialCount: number;
    layoutCount: number;
    readyMockups: string[];
  }
) {
  const includedFinal = state.finalAssets.filter((a) => a.status === "included").length;
  const includedReferences = state.references.filter((a) => a.status === "included").length;
  return {
    ok: state.finalAssets.length === 0 ? false : includedFinal === state.finalAssets.length,
    projectId: project.id,
    target,
    generatedAt: new Date().toISOString(),
    assets: {
      finalTotal: state.finalAssets.length,
      finalIncluded: includedFinal,
      referencesTotal: state.references.length,
      referencesIncluded: includedReferences,
      missing: [...state.finalAssets, ...state.references].filter((a) => a.status !== "included"),
    },
    materialization: {
      layoutCount: materialStats?.layoutCount ?? 0,
      materialCount: materialStats?.materialCount ?? 0,
      readyMockups: materialStats?.readyMockups ?? [],
    },
    designSpecs: {
      total: designSpecs.length,
      vision: designSpecs.filter((s) => s.source === "vision").length,
      heuristic: designSpecs.filter((s) => s.source === "heuristic").length,
    },
    warnings: state.warnings,
    readOrder: [
      "DESIGN.md",
      "LAYOUT.md",
      "design/layouts/*",
      "MATERIAL_MAP.md",
      "skills/design-to-code/SKILL.md",
      "assets/materials/*",
      "assets/final/*",
      "SPEC.md",
      "design/tokens.json",
      "design/tokens.dtcg.json",
    ],
  };
}

function buildAssetManifest(state: HandoffBuildState) {
  return {
    final: state.finalAssets,
    references: state.references,
  };
}

function buildModelRuns(project: ProjectFile, state: HandoffBuildState) {
  const byId = new Map(state.finalAssets.map((entry) => [entry.id, entry]));
  const runs = activeAssets(project).map((asset) => {
    const entry = byId.get(asset.id);
    return {
      id: asset.id,
      file: entry?.file,
      status: entry?.status,
      prompt: asset.prompt,
      model: asset.model,
      seed: asset.seed,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      costUsd: asset.costUsd,
      batchId: asset.batchId,
      source: asset.source,
      role: asset.role,
      parentAssetId: asset.parentAssetId,
      variantGroupId: asset.variantGroupId,
      usedInPages: asset.usedInPages,
      usedInNodes: asset.usedInNodes,
      editInstruction: asset.editInstruction,
      editRegion: asset.editRegion,
      referenceAssetIds: asset.referenceAssetIds,
      hasDesignSpec: !!asset.designSpec,
      designSpecSource: asset.designSpec?.source,
      createdAt: asset.createdAt,
      error: asset.error,
    };
  });
  return { count: runs.length, runs };
}

function extractTokens(project: ProjectFile) {
  const colors = new Set<string>();
  const fontSizes = new Set<number>();
  const radii = new Set<number>();
  const designContext = deriveDesignContext(project);
  // 占位默认色不进 tokens.json —— 交给 coding agent 的必须是有来源的颜色
  if (!isPlaceholderColorTokens(designContext?.colorTokens)) {
    for (const token of designContext?.colorTokens ?? []) colors.add(token.value);
  }
  for (const page of project.pages ?? []) {
    if (page.background) colors.add(page.background);
    for (const node of page.nodes) {
      if ("fill" in node && node.fill) colors.add(node.fill);
      if ("color" in node && node.color) colors.add(node.color);
      if ("fontSize" in node && node.fontSize) fontSizes.add(node.fontSize);
      if ("radius" in node && node.radius) radii.add(node.radius);
    }
  }
  return {
    color: [...colors],
    fontSize: [...fontSizes].sort((a, b) => a - b),
    radius: [...radii].sort((a, b) => a - b),
    moodKeywords: project.designDirection?.moodKeywords ?? [],
    visualStyle: project.brief?.visualStyle ?? null,
  };
}

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

function assetBaseName(
  prefix: "asset" | "reference",
  index: number,
  role: string | undefined,
  label: string | undefined,
  width: number,
  height: number
): string {
  const slug = slugify(role || label || "visual");
  return `${prefix}-${String(index).padStart(2, "0")}-${slug}-${Math.round(width)}x${Math.round(height)}`;
}

function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return ascii || "visual";
}

function usageForAsset(asset: HandoffAssetEntry): string {
  const prompt = asset.prompt ?? "";
  if (/home|首页|主页|首屏/i.test(prompt)) return "Primary home screen layout and visual direction.";
  if (/detail|详情/i.test(prompt)) return "Detail page layout, hierarchy, and interaction density.";
  if (/app|ui|screen|界面|页面/i.test(prompt)) return "Mobile/product UI reference.";
  if (asset.role === "background") return "Background treatment, palette, and atmosphere.";
  if (asset.role === "illustration") return "Illustration style and visual motifs.";
  return "Primary visual style, composition, color, and UI mood.";
}

function isRemoteLike(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith("/");
}

function normalizeMime(value: string | null): string | null {
  if (!value) return null;
  return value.split(";")[0].trim().toLowerCase() || null;
}

function extensionFromMime(mime: string): string | null {
  const normalized = normalizeMime(mime);
  if (!normalized) return null;
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";
  const match = normalized.match(/^image\/([a-z0-9.+-]+)$/);
  return match?.[1]?.replace("+xml", "") ?? null;
}

function mimeFromUrl(url: string): string | null {
  const ext = extensionFromUrl(url);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  return null;
}

function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && /^(png|jpg|jpeg|webp|gif|svg)$/.test(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
    if (ext && /^(png|jpg|jpeg|webp|gif|svg)$/.test(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  }
  return null;
}
