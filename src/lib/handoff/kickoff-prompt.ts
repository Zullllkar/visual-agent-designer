/**
 * Coding agent 启动 prompt（客户端可安全引用）
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { HandoffTarget } from "./types";
import { deriveDesignContext } from "@/lib/project/design-context";

function activeAssets(p: ProjectFile) {
  return (p.assets ?? []).filter((a) => a.status !== "discarded");
}

function assetFileName(id: string, src: string): string {
  const m = src.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml|gif)/i);
  const ext =
    m?.[1]?.toLowerCase() === "svg+xml"
      ? "svg"
      : m?.[1]?.toLowerCase() === "jpeg"
        ? "jpg"
        : m?.[1]?.toLowerCase() ?? "png";
  return `${id.slice(0, 12)}.${ext}`;
}

/** 可直接粘贴到 Cursor / Claude Code / Codex 的启动 prompt 正文 */
export function buildKickoffClipboardText(
  p: ProjectFile,
  target: HandoffTarget["name"] = "cursor"
): string {
  void target;
  const assets = activeAssets(p);

  return [
    `请为我实现 **${p.title}**。`,
    "",
    `**产品定位**: ${p.brief?.positioning ?? p.rawIdea}`,
    `**平台**: ${p.brief?.platform ?? "未指定"}`,
    `**视觉风格**: ${p.brief?.visualStyle ?? "现代简洁"}`,
    "",
    "请严格按照以下文件中的设计实现：",
    "",
    "- `SPEC.md`",
    ...(deriveDesignContext(p)
      ? ["- `design/design-context.json`（项目级设计记忆）"]
      : []),
    "- `design/assets/MANIFEST.md`",
    ...assets
      .slice(0, 8)
      .map((a) => `- \`design/assets/${assetFileName(a.id, a.src)}\``),
    "",
    "**实现要求**：",
    "",
    "1. 以 `design/assets/*` 图片为视觉参考（气质、配色、插图），不要另起一套风格",
    ...(deriveDesignContext(p)
      ? [
          "2. 品牌语气、色板、排版和组件原则遵循 `design/design-context.json`",
          "3. 颜色 / 字号 / 圆角引用 `design/tokens.json`",
          "4. 先实现主界面，跑通后再做其他模块",
          "5. 本包是视觉素材交付，不是网页结构 JSON 1:1 还原",
        ]
      : [
          "2. 颜色 / 字号 / 圆角引用 `design/tokens.json`",
          "3. 先实现主界面，跑通后再做其他模块",
          "4. 本包是视觉素材交付，不是网页结构 JSON 1:1 还原",
        ]),
    "",
    "完整规范见 `SPEC.md`。",
  ].join("\n");
}

/** 单张素材的交付 Prompt（浮动条「复制 Prompt」） */
export function buildSingleAssetPrompt(
  p: ProjectFile,
  asset: {
    id: string;
    prompt: string;
    role?: string;
    width: number;
    height: number;
    editInstruction?: string;
  }
): string {
  const lines = [
    `请实现 **${p.title}** 中的以下视觉素材。`,
    "",
    `**产品定位**: ${p.brief?.positioning ?? p.rawIdea}`,
    `**视觉风格**: ${p.brief?.visualStyle ?? "现代简洁"}`,
    "",
    `**素材 ID**: \`${asset.id}\``,
    `**尺寸**: ${asset.width}×${asset.height}`,
    ...(asset.role ? [`**角色**: ${asset.role}`] : []),
    "",
    "**生成 Prompt**:",
    asset.prompt,
  ];
  if (asset.editInstruction) {
    lines.push("", "**编辑指令**:", asset.editInstruction);
  }
  lines.push(
    "",
    "请以该图为视觉参考实现对应 UI，不要另起一套风格。",
    "完整项目规范见交付包中的 `SPEC.md` 与 `design/assets/MANIFEST.md`。"
  );
  return lines.join("\n");
}
