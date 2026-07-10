import type { HandoffArtifact, HandoffTarget } from "./types";
import type { ProjectFile } from "@/lib/project/schema";
import {
  deriveDesignContext,
  summarizeDesignContext,
} from "@/lib/project/design-context";
import { buildKickoffClipboardText } from "./kickoff-prompt";

/**
 * Handoff Target 工厂
 * --------------------------------------------------------------
 * Lovart 式交付：视觉素材图 + prompt + Brief/设计上下文，供 coding agent 使用。
 * 不再以 Canvas JSON / 页面 SVG 结构稿作为主交付物。
 *
 * - markdown   : 通用 README + SPEC
 * - cursor     : 多一个 .cursorrules
 * - claude-code: 多一个 CLAUDE.md
 * - codex      : 多一个 AGENTS.md
 */
export function createHandoffTarget(
  name: HandoffTarget["name"]
): HandoffTarget {
  return {
    name,
    async build({ project }) {
      return buildArtifact(project, name);
    },
  };
}

function buildArtifact(
  project: ProjectFile,
  target: HandoffTarget["name"]
): HandoffArtifact {
  const files: HandoffArtifact["files"] = [];
  const designContext = deriveDesignContext(project);

  files.push({
    path: "design/project.json",
    content: JSON.stringify(project, null, 2),
  });
  if (designContext) {
    files.push({
      path: "design/design-context.json",
      content: JSON.stringify(designContext, null, 2),
    });
  }

  if (project.brief) {
    files.push({
      path: "design/brief.json",
      content: JSON.stringify(project.brief, null, 2),
    });
  }
  if (project.designDirection) {
    files.push({
      path: "design/design-direction.json",
      content: JSON.stringify(project.designDirection, null, 2),
    });
  }

  files.push({
    path: "design/tokens.json",
    content: JSON.stringify(extractTokens(project), null, 2),
  });

  files.push({
    path: "README.md",
    content: renderReadme(project),
  });

  files.push({
    path: "SPEC.md",
    content: renderSpec(project),
  });

  if (target === "cursor") {
    files.push({
      path: ".cursorrules",
      content: renderCursorRules(project),
    });
  } else if (target === "claude-code") {
    files.push({
      path: "CLAUDE.md",
      content: renderClaudeMd(project),
    });
  } else if (target === "codex") {
    files.push({
      path: "AGENTS.md",
      content: renderAgentsMd(project),
    });
  }

  files.push({
    path: `prompts/${target}-kickoff.md`,
    content: renderKickoffPrompt(project, target),
  });

  // 素材清单（给人读）
  files.push({
    path: "design/assets/MANIFEST.md",
    content: renderAssetsManifest(project),
  });

  appendImageAssets(project, files);
  appendReferenceAssets(project, files);

  return { files };
}

/**
 * 把 project.assets[] 和 page 内的 image node 的 generation 元数据合并：
 *   - 候选图：解码 data URL 写入 design/assets/*
 *   - 远端 URL（https://...）：写一个占位 .url.txt，避免下载阻塞
 *   - model-runs.json：完整 metadata 数组，供追溯模型/prompt/seed
 */
function appendImageAssets(
  project: ProjectFile,
  files: HandoffArtifact["files"]
) {
  const runs: Array<Record<string, unknown>> = [];
  const assets = project.assets ?? [];

  for (const a of assets) {
    const fname = assetFileName(a.id, a.src);
    const content = decodeAssetSrc(a.src);
    if (content != null) {
      files.push({ path: `design/assets/${fname}`, content });
    } else {
      // 不是 data URL 时直接记 url，方便用户自取
      files.push({
        path: `design/assets/${a.id}.url.txt`,
        content: a.src,
      });
    }
    runs.push({
      kind: "asset",
      id: a.id,
      file: `design/assets/${fname}`,
      prompt: a.prompt,
      model: a.model,
      seed: a.seed,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      costUsd: a.costUsd,
      status: a.status,
      batchId: a.batchId,
      source: a.source,
      parentAssetId: a.parentAssetId,
      variantGroupId: a.variantGroupId,
      role: a.role,
      usedInNodes: a.usedInNodes,
      editInstruction: a.editInstruction,
      referenceAssetIds: a.referenceAssetIds,
      designContextVersion: a.designContextVersion,
      createdAt: a.createdAt,
      usedInPages: a.usedInPages,
    });
  }

  if (runs.length > 0) {
    files.push({
      path: "design/model-runs.json",
      content: JSON.stringify({ count: runs.length, runs }, null, 2),
    });
  }
}

function appendReferenceAssets(
  project: ProjectFile,
  files: HandoffArtifact["files"]
) {
  const references = project.references ?? [];
  if (references.length === 0) return;

  const manifest = references.map((ref) => {
    const fname = assetFileName(ref.id, ref.src);
    const content = decodeAssetSrc(ref.src);
    if (content != null) {
      files.push({ path: `design/references/${fname}`, content });
    } else {
      files.push({
        path: `design/references/${ref.id}.url.txt`,
        content: ref.src,
      });
    }
    return {
      id: ref.id,
      label: ref.label,
      file: `design/references/${fname}`,
      width: ref.width,
      height: ref.height,
      source: ref.source,
      tags: ref.tags,
      notes: ref.notes,
      createdAt: ref.createdAt,
    };
  });

  files.push({
    path: "design/references.json",
    content: JSON.stringify({ count: manifest.length, references: manifest }, null, 2),
  });
}

/** 选择文件名：尽量保留扩展名，否则按 mime 推断。 */
function assetFileName(id: string, src: string): string {
  // data:image/png;base64,...  / data:image/svg+xml;utf8,...
  const m = src.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml|gif)/i);
  if (m) {
    const ext = m[1].toLowerCase() === "svg+xml" ? "svg" : m[1].toLowerCase();
    return `${id}.${ext}`;
  }
  return `${id}.png`;
}

/**
 * 把 data URL 解码成 JSZip 可吞下的内容：
 *   - base64 PNG/JPEG/WEBP → Uint8Array
 *   - utf8 SVG → string
 *   - 非 data URL → null（调用方写占位文件）
 */
function decodeAssetSrc(src: string): string | Uint8Array | null {
  const dataMatch = src.match(/^data:([^,;]+)(;base64)?(;[^,]+)?,(.+)$/);
  if (!dataMatch) return null;
  const isB64 = !!dataMatch[2];
  const payload = dataMatch[4];
  if (isB64) {
    if (typeof atob !== "undefined") {
      const bin = atob(payload);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    // Node 环境
    return Buffer.from(payload, "base64");
  }
  return decodeURIComponent(payload);
}

/* ───────────────────────── 内容生成 ───────────────────────── */

function activeAssets(p: ProjectFile) {
  return (p.assets ?? []).filter((a) => a.status !== "discarded");
}

function renderAssetsManifest(p: ProjectFile): string {
  const assets = activeAssets(p);
  const lines = [
    `# 视觉素材清单`,
    "",
    `共 ${assets.length} 张可交付素材。`,
    "",
  ];
  if (assets.length === 0) {
    lines.push("_暂无素材。请先在 VAD 中用 Agent 生成图片。_");
    return lines.join("\n");
  }
  assets.forEach((a, i) => {
    const fname = assetFileName(a.id, a.src);
    lines.push(`## ${i + 1}. \`${fname}\``);
    lines.push("");
    lines.push(`- 尺寸: ${a.width} × ${a.height}`);
    lines.push(`- 状态: ${a.status ?? "candidate"}`);
    if (a.role) lines.push(`- 角色: ${a.role}`);
    if (a.model) lines.push(`- 模型: ${a.model}`);
    lines.push(`- Prompt:`);
    lines.push("");
    lines.push("```");
    lines.push(a.prompt);
    lines.push("```");
    lines.push("");
  });
  return lines.join("\n");
}

function renderReadme(p: ProjectFile): string {
  const b = p.brief;
  const assets = activeAssets(p);
  return [
    `# ${p.title}`,
    "",
    `> ${p.rawIdea}`,
    "",
    "**生成自 Visual Agent Designer**。本目录是给 coding agent 的**视觉素材交付包**（图片 + prompt + 设计上下文），不是网页结构代码框。",
    "",
    "## 项目信息",
    "",
    b
      ? [
          `- 产品名: ${b.productName}`,
          `- 定位: ${b.positioning}`,
          `- 目标用户: ${b.targetUser}`,
          `- 平台: ${b.platform}`,
          `- 视觉风格: ${b.visualStyle}`,
          `- 核心功能: ${b.coreFeatures.join(" / ")}`,
        ].join("\n")
      : "- 暂无 Brief。",
    "",
    `## 素材概览（${assets.length} 张）`,
    "",
    assets.length > 0
      ? assets
          .slice(0, 12)
          .map(
            (a) =>
              `- \`${assetFileName(a.id, a.src)}\` · ${a.width}×${a.height}${a.role ? ` · ${a.role}` : ""}`
          )
          .join("\n")
      : "- 暂无素材文件。",
    "",
    "## 目录结构",
    "",
    "```",
    "design/",
    "  project.json          # 完整项目数据",
    "  brief.json            # 产品 Brief",
    "  design-direction.json # 视觉方向",
    ...(deriveDesignContext(p)
      ? ["  design-context.json   # 项目级设计记忆"]
      : []),
    "  tokens.json           # 设计 token",
    "  assets/               # ★ 可交付视觉素材（PNG 等）",
    "    MANIFEST.md         # 素材清单 + prompt",
    "    model-runs.json     # 生图元数据",
    ...(p.references?.length ? ["  references/           # 用户参考图"] : []),
    "prompts/                # coding agent 启动 prompt",
    "SPEC.md                 # 产品与实现规范",
    "```",
    "",
    "## 推荐使用方式",
    "",
    "1. 在 Cursor / Claude Code / Codex 里打开本目录",
    "2. 阅读 `SPEC.md` 与 `design/assets/MANIFEST.md`",
    "3. 把 `design/assets/*` 图片当作 UI 参考 / 插图资源嵌入实现",
    "4. 按 `prompts/<agent>-kickoff.md` 启动开发",
    "",
  ].join("\n");
}

function renderSpec(p: ProjectFile): string {
  const b = p.brief;
  const designContext = deriveDesignContext(p);
  const assets = activeAssets(p);
  const lines: string[] = [];
  lines.push(`# ${p.title} · 产品规范`);
  lines.push("");
  lines.push("## 1. 产品概述");
  lines.push("");
  lines.push(`**原始想法**: ${p.rawIdea}`);
  lines.push("");
  if (b) {
    lines.push(`**定位**: ${b.positioning}`);
    lines.push(`**目标用户**: ${b.targetUser}`);
    lines.push(`**平台**: ${b.platform}`);
    lines.push(`**视觉风格**: ${b.visualStyle}`);
    lines.push("");
    lines.push("### 核心功能");
    lines.push("");
    b.coreFeatures.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
    lines.push("### 关键场景");
    lines.push("");
    b.scenarios.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  if (p.designDirection) {
    lines.push("## 2. 视觉方向");
    lines.push("");
    lines.push(p.designDirection.summary);
    if (p.designDirection.moodKeywords.length > 0) {
      lines.push("");
      lines.push(`**气质关键词**: ${p.designDirection.moodKeywords.join(" · ")}`);
    }
    lines.push("");
  }

  const sectionDesign = p.designDirection ? 3 : 2;
  if (designContext) {
    lines.push(`## ${sectionDesign}. 设计记忆`);
    lines.push("");
    lines.push(
      "编码实现必须保持以下品牌、视觉、文案和组件一致性。完整 JSON 见 `design/design-context.json`。"
    );
    lines.push("");
    lines.push("```");
    lines.push(summarizeDesignContext(designContext));
    lines.push("```");
    lines.push("");
    lines.push("### 色板");
    lines.push("");
    designContext.colorTokens.forEach((token) => {
      lines.push(`- ${token.name}: \`${token.value}\` — ${token.usage}`);
    });
    lines.push("");
    lines.push("### 执行准则");
    lines.push("");
    designContext.doList.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("### 避免事项");
    lines.push("");
    designContext.avoidList.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  const sectionAssets =
    (p.designDirection ? 1 : 0) + (designContext ? 1 : 0) + 2;
  lines.push(`## ${sectionAssets}. 视觉素材（主交付）`);
  lines.push("");
  lines.push(
    `共 ${assets.length} 张。详见 \`design/assets/MANIFEST.md\`。实现时以这些图片为视觉参考，不要自行发明另一套 UI 气质。`
  );
  lines.push("");
  assets.forEach((a, i) => {
    lines.push(`### ${sectionAssets}.${i + 1} ${assetFileName(a.id, a.src)}`);
    lines.push("");
    lines.push(`- 尺寸: ${a.width} × ${a.height}`);
    if (a.role) lines.push(`- 角色: ${a.role}`);
    lines.push(`- Prompt: ${truncate(a.prompt, 120)}`);
    lines.push("");
  });

  lines.push(`## ${sectionAssets + 1}. 实现要求`);
  lines.push("");
  if (designContext) {
    lines.push(
      "- 开始编码前先读取 `design/design-context.json`，保持品牌语气、色板、排版与组件原则一致"
    );
  }
  lines.push("- **以 `design/assets/*` 视觉素材为主要参考**，还原气质、配色、层级与关键插图");
  lines.push("- 文案与产品定位以 `SPEC.md` / `design/brief.json` 为准");
  lines.push("- 颜色 / 字号 / 间距优先引用 `design/tokens.json`");
  lines.push("- 不要把本包当成「网页结构 JSON 1:1 还原」任务；这是视觉参考 + 产品上下文");
  lines.push(
    `- 平台为 \`${b?.platform ?? "web"}\` 时选择合适技术栈（如 Next.js / RN / Flutter）`
  );
  return lines.join("\n");
}

function renderCursorRules(p: ProjectFile): string {
  return [
    `# ${p.title} - Cursor Rules`,
    "",
    "你正在为这个产品写代码。请遵循以下原则：",
    "",
    "- 始终先读取 `SPEC.md` 与 `design/assets/MANIFEST.md`",
    "- 打开 `design/assets/*` 图片作为 UI / 插图视觉参考",
    ...(deriveDesignContext(p)
      ? [
          "- 先读取 `design/design-context.json`，保持设计记忆中的品牌语气、色板和组件原则",
        ]
      : []),
    "- 颜色 / 字号 / 间距引用 `design/tokens.json`",
    `- 视觉风格: ${p.brief?.visualStyle ?? "现代简洁"}`,
    `- 平台: ${p.brief?.platform ?? "未指定"}`,
    "- 本包是视觉素材交付，不是 Canvas JSON 结构稿；按参考图气质实现，勿臆造另一套风格",
    "",
  ].join("\n");
}

function renderClaudeMd(p: ProjectFile): string {
  return [
    `# CLAUDE.md`,
    "",
    `这是 ${p.title} 项目。Claude Code 会自动读取此文件。`,
    "",
    "## 上下文文件",
    "",
    "- `SPEC.md`：产品规范（必读）",
    "- `design/assets/MANIFEST.md` + `design/assets/*`：可交付视觉素材与 prompt",
    ...(deriveDesignContext(p)
      ? [
          "- `design/design-context.json`：项目级设计记忆，约束品牌语气、色彩、排版和组件原则",
        ]
      : []),
    "- `design/tokens.json`：颜色 / 字号 / 间距",
    "- `design/brief.json`：产品 Brief",
    "",
    "## 工作流程",
    "",
    "1. 阅读 `SPEC.md` 与素材清单",
    "2. 浏览 `design/assets/*` 图片，确认视觉气质",
    "3. 与用户确认先实现的界面 / 模块",
    "4. 按素材气质与 Brief 实现；不要当作网页结构 JSON 1:1 还原",
    "",
  ].join("\n");
}

function renderAgentsMd(p: ProjectFile): string {
  return [
    `# AGENTS.md`,
    "",
    `这是 ${p.title} 项目，由 Visual Agent Designer 生成。`,
    "",
    "Codex / OpenAI Agent 会自动读取本文件作为系统上下文。",
    "",
    "## 必读文件",
    "",
    "- `SPEC.md`",
    "- `design/assets/MANIFEST.md`",
    "- `design/assets/*`（视觉素材）",
    ...(deriveDesignContext(p) ? ["- `design/design-context.json`"] : []),
    "- `design/tokens.json`",
    "",
    "## 实现纪律",
    "",
    "- 以视觉素材图为主要参考，保持气质与配色一致",
    ...(deriveDesignContext(p)
      ? ["- 保持 design-context.json 中的品牌语气、色板、排版和组件原则"]
      : []),
    "- 颜色 / 字号 / 间距引用 tokens.json",
    "- 不要假设设计意图；遇到歧义先看素材图与 MANIFEST 中的 prompt",
    "",
  ].join("\n");
}

function renderKickoffPrompt(
  p: ProjectFile,
  target: HandoffTarget["name"]
): string {
  const target_label =
    target === "cursor"
      ? "Cursor"
      : target === "claude-code"
        ? "Claude Code"
        : target === "codex"
          ? "Codex"
          : "AI 编码助手";

  return [
    `# ${target_label} 启动 Prompt`,
    "",
    "复制下面的内容粘贴到对话框：",
    "",
    "---",
    "",
    buildKickoffClipboardText(p, target),
    "",
  ].join("\n");
}

/* ───────────────────────── 工具 ───────────────────────── */

function extractTokens(p: ProjectFile) {
  const colors = new Set<string>();
  const fontSizes = new Set<number>();
  const radii = new Set<number>();
  for (const token of deriveDesignContext(p)?.colorTokens ?? []) {
    colors.add(token.value);
  }
  // 兼容旧项目：若仍有 pages，从中扫 token
  for (const page of p.pages ?? []) {
    if (page.background) colors.add(page.background);
    for (const n of page.nodes) {
      if ("fill" in n && n.fill) colors.add(n.fill);
      if ("color" in n && n.color) colors.add(n.color);
      if ("fontSize" in n && n.fontSize) fontSizes.add(n.fontSize);
      if ("radius" in n && n.radius) radii.add(n.radius);
    }
  }
  return {
    color: [...colors],
    fontSize: [...fontSizes].sort((a, b) => a - b),
    radius: [...radii].sort((a, b) => a - b),
    moodKeywords: p.designDirection?.moodKeywords ?? [],
    visualStyle: p.brief?.visualStyle ?? null,
  };
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
