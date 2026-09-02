/**
 * manipulate_canvas 工具
 * --------------------------------------------------------------
 * 对画布元素执行操作：移动、调整大小、删除、重排序、标记素材角色、
 * 添加文本、添加形状、更新样式、更新文本内容。
 */

import { nanoid } from "nanoid";
import type { AgentTool, ToolContext, ToolResult } from "./types";
import { ProjectFileSchema } from "./utils";
import type { CanvasNode, CanvasPage } from "@/lib/canvas/schema";

export const manipulateCanvasTool: AgentTool = {
  name: "manipulate_canvas",
  description:
    "操作画布元素：移动、调整大小、删除、重排序、标记角色、添加文本、添加形状/线条、更新样式、更新文本、对齐、分布",
  inputPhase: ["GENERATION", "REVIEW"],
  outputPhase: "REVIEW",
  riskLevel: "moderate",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "move",
          "resize",
          "delete",
          "reorder",
          "tag",
          "add_text",
          "add_shape",
          "add_line",
          "update_style",
          "update_text",
          "align",
          "distribute",
        ],
        description: "操作类型",
      },
      targetId: { type: "string", description: "目标元素 ID" },
      tag: { type: "string", description: "tag 操作的角色名" },
      pageId: { type: "string", description: "操作的目标页面 ID" },
      x: { type: "number", description: "move/resize/add 操作的 x 坐标" },
      y: { type: "number", description: "move/resize/add 操作的 y 坐标" },
      width: { type: "number", description: "resize/add 操作的宽度" },
      height: { type: "number", description: "resize/add 操作的高度" },
      beforeId: {
        type: "string",
        description: "reorder 操作：将 targetId 移到 beforeId 之前",
      },
      // add_text / update_text 参数
      content: { type: "string", description: "add_text/update_text 的文本内容" },
      fontSize: { type: "number", description: "文本字号" },
      fontWeight: { type: "number", description: "文本字重 (100-900)" },
      color: { type: "string", description: "文本/形状颜色" },
      align: {
        type: "string",
        enum: ["left", "center", "right"],
        description: "文本对齐方式",
      },
      // add_shape 参数
      shape: {
        type: "string",
        enum: ["frame", "card", "rect", "ellipse", "triangle", "star"],
        description: "add_shape 的形状类型",
      },
      fill: { type: "string", description: "形状填充色" },
      radius: { type: "number", description: "形状圆角半径" },
      stroke: { type: "string", description: "线条/形状描边色" },
      strokeWidth: { type: "number", description: "线条/形状描边宽度" },
      // add_line 参数
      x2: { type: "number", description: "add_line: 线段终点 x 坐标" },
      y2: { type: "number", description: "add_line: 线段终点 y 坐标" },
      arrow: { type: "boolean", description: "add_line: 是否带箭头" },
      // align / distribute 参数
      targetIds: {
        type: "array",
        items: { type: "string" },
        description: "align/distribute: 要对齐/分布的节点 ID 列表",
      },
      alignMode: {
        type: "string",
        enum: ["left", "center", "right", "top", "middle", "bottom"],
        description: "align: 对齐方式",
      },
      distributeAxis: {
        type: "string",
        enum: ["horizontal", "vertical"],
        description: "distribute: 分布轴",
      },
      // update_style 参数
      style: {
        type: "object",
        description: "update_style 的样式更新对象",
        properties: {
          fill: { type: "string" },
          color: { type: "string" },
          radius: { type: "number" },
          fontSize: { type: "number" },
          fontWeight: { type: "number" },
          align: { type: "string" },
        },
      },
    },
    required: ["action"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!ctx.project) throw new Error("缺少项目");
    const action = args.action as string;
    const now = new Date().toISOString();

    // ── tag: 标记素材角色 ──
    if (action === "tag") {
      return doTag(args, ctx, now);
    }

    // ── delete: 删除素材 ──
    if (action === "delete") {
      return doDelete(args, ctx, now);
    }

    // ── move: 移动节点 ──
    if (action === "move") {
      return doMove(args, ctx, now);
    }

    // ── resize: 调整节点大小 ──
    if (action === "resize") {
      return doResize(args, ctx, now);
    }

    // ── reorder: 重排序节点 ──
    if (action === "reorder") {
      return doReorder(args, ctx, now);
    }

    // ── add_text: 添加文本节点 ──
    if (action === "add_text") {
      return doAddText(args, ctx, now);
    }

    // ── add_shape: 添加形状节点 ──
    if (action === "add_shape") {
      return doAddShape(args, ctx, now);
    }

    // ── update_style: 更新节点样式 ──
    if (action === "update_style") {
      return doUpdateStyle(args, ctx, now);
    }

    // ── update_text: 更新文本内容 ──
    if (action === "update_text") {
      return doUpdateText(args, ctx, now);
    }

    // ── add_line: 添加线段 ──
    if (action === "add_line") {
      return doAddLine(args, ctx, now);
    }

    // ── align: 对齐多个节点 ──
    if (action === "align") {
      return doAlign(args, ctx, now);
    }

    // ── distribute: 均匀分布多个节点 ──
    if (action === "distribute") {
      return doDistribute(args, ctx, now);
    }

    return {
      summary: `未知画布操作: ${action}`,
    };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};

// ──────────────────────────────────────────────────────────────────
// 操作实现
// ──────────────────────────────────────────────────────────────────

function doTag(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const targetId = args.targetId as string;
  const tag = args.tag as string;
  const assets = ctx.project!.assets ?? [];
  const idx = assets.findIndex((a) => a.id === targetId);
  if (idx === -1) throw new Error(`素材 ${targetId} 不存在`);
  const updatedAssets = [...assets];
  updatedAssets[idx] = { ...updatedAssets[idx], role: tag as never };
  return {
    summary: `已将素材 ${targetId.slice(0, 8)} 标记为 ${tag}`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      assets: updatedAssets,
      updatedAt: now,
    }),
  };
}

function doDelete(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const targetId = args.targetId as string;
  const assets = ctx.project!.assets ?? [];
  const idx = assets.findIndex((a) => a.id === targetId);
  if (idx === -1) throw new Error(`素材 ${targetId} 不存在`);
  const updatedAssets = [...assets];
  updatedAssets[idx] = { ...updatedAssets[idx], status: "discarded" };
  return {
    summary: `已删除素材 ${targetId.slice(0, 8)}`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      assets: updatedAssets,
      updatedAt: now,
    }),
  };
}

function updatePageNode(
  ctx: ToolContext,
  pageId: string,
  nodeId: string,
  updater: (node: CanvasNode) => CanvasNode,
  now: string
): { pages: CanvasPage[]; page: CanvasPage; node: CanvasNode } {
  const pages = ctx.project!.pages ?? [];
  const pageIdx = pages.findIndex((p) => p.id === pageId);
  if (pageIdx === -1) throw new Error(`页面 ${pageId} 不存在`);
  const page = pages[pageIdx];
  const nodeIdx = page.nodes.findIndex((n) => n.id === nodeId);
  if (nodeIdx === -1) throw new Error(`节点 ${nodeId} 不存在于页面 ${pageId}`);
  const updatedNodes = [...page.nodes];
  const updatedNode = updater(updatedNodes[nodeIdx]);
  updatedNodes[nodeIdx] = updatedNode;
  const updatedPages = [...pages];
  updatedPages[pageIdx] = { ...page, nodes: updatedNodes };
  return { pages: updatedPages, page: updatedPages[pageIdx], node: updatedNode };
}

function doMove(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const targetId = args.targetId as string;
  const newX = args.x as number | undefined;
  const newY = args.y as number | undefined;
  if (!pageId || newX === undefined || newY === undefined) {
    throw new Error("move 操作需要 pageId, x, y 参数");
  }
  const { pages, node } = updatePageNode(ctx, pageId, targetId, (n) => ({
    ...n,
    x: newX,
    y: newY,
  }), now);
  return {
    summary: `已移动节点 ${targetId.slice(0, 8)} 到 (${newX}, ${newY})`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages,
      updatedAt: now,
    }),
  };
}

function doResize(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const targetId = args.targetId as string;
  const newW = args.width as number | undefined;
  const newH = args.height as number | undefined;
  if (!pageId || newW === undefined || newH === undefined) {
    throw new Error("resize 操作需要 pageId, width, height 参数");
  }
  const { pages } = updatePageNode(ctx, pageId, targetId, (n) => ({
    ...n,
    width: Math.max(1, newW),
    height: Math.max(1, newH),
  }), now);
  return {
    summary: `已调整节点 ${targetId.slice(0, 8)} 大小为 ${newW}x${newH}`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages,
      updatedAt: now,
    }),
  };
}

function doReorder(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const targetId = args.targetId as string;
  const beforeId = args.beforeId as string | undefined;
  if (!pageId) throw new Error("reorder 操作需要 pageId 参数");
  const pages = ctx.project!.pages ?? [];
  const pageIdx = pages.findIndex((p) => p.id === pageId);
  if (pageIdx === -1) throw new Error(`页面 ${pageId} 不存在`);
  const page = pages[pageIdx];
  const nodeIdx = page.nodes.findIndex((n) => n.id === targetId);
  if (nodeIdx === -1) throw new Error(`节点 ${targetId} 不存在于页面 ${pageId}`);

  const nodes = [...page.nodes];
  const [moved] = nodes.splice(nodeIdx, 1);
  let insertIdx = nodes.length;
  if (beforeId) {
    const beforeIdx = nodes.findIndex((n) => n.id === beforeId);
    if (beforeIdx !== -1) insertIdx = beforeIdx;
  }
  nodes.splice(insertIdx, 0, moved);

  const updatedPages = [...pages];
  updatedPages[pageIdx] = { ...page, nodes };
  return {
    summary: `已重排序节点 ${targetId.slice(0, 8)}`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages: updatedPages,
      updatedAt: now,
    }),
  };
}

function doAddText(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const content = args.content as string;
  const x = (args.x as number) ?? 0;
  const y = (args.y as number) ?? 0;
  const width = (args.width as number) ?? 200;
  const height = (args.height as number) ?? 40;
  if (!pageId) throw new Error("add_text 操作需要 pageId 参数");
  if (!content) throw new Error("add_text 操作需要 content 参数");

  const nodeId = nanoid(10);
  const newNode: CanvasNode = {
    type: "text" as const,
    id: nodeId,
    x,
    y,
    width,
    height,
    content,
    ...(args.color ? { color: args.color as string } : {}),
    ...(args.fontSize ? { fontSize: args.fontSize as number } : {}),
    ...(args.fontWeight ? { fontWeight: args.fontWeight as number } : {}),
    ...(args.align ? { align: args.align as "left" | "center" | "right" } : {}),
    source: "agent",
  };

  const pages = ctx.project!.pages ?? [];
  const pageIdx = pages.findIndex((p) => p.id === pageId);
  if (pageIdx === -1) throw new Error(`页面 ${pageId} 不存在`);
  const updatedPages = [...pages];
  updatedPages[pageIdx] = {
    ...pages[pageIdx],
    nodes: [...pages[pageIdx].nodes, newNode],
  };

  return {
    summary: `已添加文本节点 "${content.slice(0, 20)}" 到页面 ${pageId}`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages: updatedPages,
      updatedAt: now,
    }),
  };
}

function doAddShape(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const shape = (args.shape as string) ?? "frame";
  const x = (args.x as number) ?? 0;
  const y = (args.y as number) ?? 0;
  const width = (args.width as number) ?? 100;
  const height = (args.height as number) ?? 100;
  if (!pageId) throw new Error("add_shape 操作需要 pageId 参数");

  const nodeId = nanoid(10);
  const baseNode = {
    id: nodeId,
    x,
    y,
    width,
    height,
    source: "agent",
    ...(args.fill ? { fill: args.fill as string } : {}),
    ...(args.radius ? { radius: args.radius as number } : {}),
  };

  const newNode: CanvasNode =
    shape === "card"
      ? {
          type: "card" as const,
          ...baseNode,
          ...(args.content ? { title: args.content as string } : {}),
        }
      : shape === "frame"
      ? { type: "frame" as const, ...baseNode }
      : {
          type: "shape" as const,
          shape: shape as "rect" | "ellipse" | "triangle" | "star",
          ...baseNode,
          ...(args.stroke ? { stroke: args.stroke as string } : {}),
          ...(args.strokeWidth ? { strokeWidth: args.strokeWidth as number } : {}),
        };

  const pages = ctx.project!.pages ?? [];
  const pageIdx = pages.findIndex((p) => p.id === pageId);
  if (pageIdx === -1) throw new Error(`页面 ${pageId} 不存在`);
  const updatedPages = [...pages];
  updatedPages[pageIdx] = {
    ...pages[pageIdx],
    nodes: [...pages[pageIdx].nodes, newNode],
  };

  return {
    summary: `已添加 ${shape} 节点到页面 ${pageId}`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages: updatedPages,
      updatedAt: now,
    }),
  };
}

function doUpdateStyle(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const targetId = args.targetId as string;
  const style = (args.style as Record<string, unknown>) ?? {};
  if (!pageId || !targetId) throw new Error("update_style 操作需要 pageId 和 targetId");

  const { pages } = updatePageNode(ctx, pageId, targetId, (n) => {
    const updated = { ...n } as Record<string, unknown>;
    if (style.fill !== undefined && "fill" in updated) updated.fill = style.fill;
    if (style.color !== undefined && "color" in updated) updated.color = style.color;
    if (style.radius !== undefined && "radius" in updated) updated.radius = style.radius;
    if (style.fontSize !== undefined && "fontSize" in updated) updated.fontSize = style.fontSize;
    if (style.fontWeight !== undefined && "fontWeight" in updated) updated.fontWeight = style.fontWeight;
    if (style.align !== undefined && "align" in updated) updated.align = style.align;
    return updated as unknown as CanvasNode;
  }, now);

  return {
    summary: `已更新节点 ${targetId.slice(0, 8)} 的样式`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages,
      updatedAt: now,
    }),
  };
}

function doUpdateText(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const targetId = args.targetId as string;
  const content = args.content as string;
  if (!pageId || !targetId) throw new Error("update_text 操作需要 pageId 和 targetId");
  if (content === undefined) throw new Error("update_text 操作需要 content 参数");

  const { pages } = updatePageNode(ctx, pageId, targetId, (n) => {
    if (n.type !== "text") throw new Error(`节点 ${targetId} 不是文本类型`);
    return {
      ...n,
      content,
      ...(args.fontSize ? { fontSize: args.fontSize as number } : {}),
      ...(args.fontWeight ? { fontWeight: args.fontWeight as number } : {}),
      ...(args.color ? { color: args.color as string } : {}),
      ...(args.align ? { align: args.align as "left" | "center" | "right" } : {}),
    } as CanvasNode;
  }, now);

  return {
    summary: `已更新文本节点 ${targetId.slice(0, 8)} 的内容`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages,
      updatedAt: now,
    }),
  };
}

function doAddLine(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const x = (args.x as number) ?? 0;
  const y = (args.y as number) ?? 0;
  const x2 = (args.x2 as number) ?? 100;
  const y2 = (args.y2 as number) ?? 100;
  if (!pageId) throw new Error("add_line 操作需要 pageId 参数");

  const nodeId = nanoid(10);
  const newNode: CanvasNode = {
    type: "line" as const,
    id: nodeId,
    x,
    y,
    width: Math.abs(x2 - x),
    height: Math.abs(y2 - y),
    x2,
    y2,
    ...(args.stroke ? { stroke: args.stroke as string } : {}),
    ...(args.strokeWidth ? { strokeWidth: args.strokeWidth as number } : {}),
    ...(args.arrow ? { arrow: args.arrow as boolean } : {}),
    source: "agent",
  };

  const pages = ctx.project!.pages ?? [];
  const pageIdx = pages.findIndex((p) => p.id === pageId);
  if (pageIdx === -1) throw new Error(`页面 ${pageId} 不存在`);
  const updatedPages = [...pages];
  updatedPages[pageIdx] = {
    ...pages[pageIdx],
    nodes: [...pages[pageIdx].nodes, newNode],
  };

  return {
    summary: `已添加线段 (${x},${y}) → (${x2},${y2}) 到页面 ${pageId}`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages: updatedPages,
      updatedAt: now,
    }),
  };
}

function doAlign(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const targetIds = args.targetIds as string[] | undefined;
  const mode = args.alignMode as string | undefined;
  if (!pageId || !targetIds || targetIds.length < 2) {
    throw new Error("align 操作需要 pageId, targetIds (≥2), alignMode 参数");
  }
  if (!mode) throw new Error("align 操作需要 alignMode 参数");

  const pages = ctx.project!.pages ?? [];
  const pageIdx = pages.findIndex((p) => p.id === pageId);
  if (pageIdx === -1) throw new Error(`页面 ${pageId} 不存在`);
  const page = pages[pageIdx];

  const nodes = [...page.nodes];
  const targets = targetIds
    .map((id) => nodes.findIndex((n) => n.id === id))
    .filter((idx) => idx !== -1);
  if (targets.length < 2) throw new Error("找不到足够的对齐目标节点");

  const targetNodes = targets.map((idx) => nodes[idx]);

  if (mode === "left") {
    const minX = Math.min(...targetNodes.map((n) => n.x));
    targets.forEach((idx) => { nodes[idx] = { ...nodes[idx], x: minX }; });
  } else if (mode === "right") {
    const maxX = Math.max(...targetNodes.map((n) => n.x + n.width));
    targets.forEach((idx) => { nodes[idx] = { ...nodes[idx], x: maxX - nodes[idx].width }; });
  } else if (mode === "center") {
    const centers = targetNodes.map((n) => n.x + n.width / 2);
    const avgCenter = centers.reduce((a, b) => a + b, 0) / centers.length;
    targets.forEach((idx) => { nodes[idx] = { ...nodes[idx], x: avgCenter - nodes[idx].width / 2 }; });
  } else if (mode === "top") {
    const minY = Math.min(...targetNodes.map((n) => n.y));
    targets.forEach((idx) => { nodes[idx] = { ...nodes[idx], y: minY }; });
  } else if (mode === "bottom") {
    const maxY = Math.max(...targetNodes.map((n) => n.y + n.height));
    targets.forEach((idx) => { nodes[idx] = { ...nodes[idx], y: maxY - nodes[idx].height }; });
  } else if (mode === "middle") {
    const centers = targetNodes.map((n) => n.y + n.height / 2);
    const avgCenter = centers.reduce((a, b) => a + b, 0) / centers.length;
    targets.forEach((idx) => { nodes[idx] = { ...nodes[idx], y: avgCenter - nodes[idx].height / 2 }; });
  }

  const updatedPages = [...pages];
  updatedPages[pageIdx] = { ...page, nodes };

  return {
    summary: `已对齐 ${targets.length} 个节点 (${mode})`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages: updatedPages,
      updatedAt: now,
    }),
  };
}

function doDistribute(args: Record<string, unknown>, ctx: ToolContext, now: string): ToolResult {
  const pageId = args.pageId as string;
  const targetIds = args.targetIds as string[] | undefined;
  const axis = args.distributeAxis as string | undefined;
  if (!pageId || !targetIds || targetIds.length < 3) {
    throw new Error("distribute 操作需要 pageId, targetIds (≥3), distributeAxis 参数");
  }
  if (!axis) throw new Error("distribute 操作需要 distributeAxis 参数");

  const pages = ctx.project!.pages ?? [];
  const pageIdx = pages.findIndex((p) => p.id === pageId);
  if (pageIdx === -1) throw new Error(`页面 ${pageId} 不存在`);
  const page = pages[pageIdx];

  const nodes = [...page.nodes];
  const targets = targetIds
    .map((id) => ({ id, idx: nodes.findIndex((n) => n.id === id) }))
    .filter((t) => t.idx !== -1);

  if (targets.length < 3) throw new Error("找不到足够的分布目标节点 (需要≥3)");

  if (axis === "horizontal") {
    targets.sort((a, b) => nodes[a.idx].x - nodes[b.idx].x);
    const first = nodes[targets[0].idx];
    const last = nodes[targets[targets.length - 1].idx];
    const totalSpace = (last.x + last.width) - first.x;
    const totalNodeWidth = targets.reduce((sum, t) => sum + nodes[t.idx].width, 0);
    const gap = (totalSpace - totalNodeWidth) / (targets.length - 1);
    let cursor = first.x;
    for (const t of targets) {
      nodes[t.idx] = { ...nodes[t.idx], x: cursor };
      cursor += nodes[t.idx].width + gap;
    }
  } else {
    targets.sort((a, b) => nodes[a.idx].y - nodes[b.idx].y);
    const first = nodes[targets[0].idx];
    const last = nodes[targets[targets.length - 1].idx];
    const totalSpace = (last.y + last.height) - first.y;
    const totalNodeHeight = targets.reduce((sum, t) => sum + nodes[t.idx].height, 0);
    const gap = (totalSpace - totalNodeHeight) / (targets.length - 1);
    let cursor = first.y;
    for (const t of targets) {
      nodes[t.idx] = { ...nodes[t.idx], y: cursor };
      cursor += nodes[t.idx].height + gap;
    }
  }

  const updatedPages = [...pages];
  updatedPages[pageIdx] = { ...page, nodes };

  return {
    summary: `已沿 ${axis} 轴均匀分布 ${targets.length} 个节点`,
    updatedProject: ProjectFileSchema.parse({
      ...ctx.project,
      pages: updatedPages,
      updatedAt: now,
    }),
  };
}
