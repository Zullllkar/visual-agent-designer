/**
 * 用户点确认后的事件顺序与中文阐述
 */

const IMAGE_TOOLS = new Set([
  "generate_images",
  "generate_image_variants",
  "restyle_page_images",
]);

export function isCanvasImageTool(toolName: string | undefined): boolean {
  return Boolean(toolName && IMAGE_TOOLS.has(toolName));
}

/** 点确认后立刻出现的思考文案 */
export function imageApprovalThinkingText(toolName: string): string {
  if (isCanvasImageTool(toolName)) {
    return "\n已确认，正在生成并放到画布上。\n";
  }
  return `\n已确认，正在执行 ${toolName}。\n`;
}

/** 点确认后出现在对话里的阐述 */
export function imageApprovalNarration(toolName: string): string | null {
  if (!isCanvasImageTool(toolName)) return null;
  return "正在生成封面，画布上会出现占位图和 loading。\n";
}

/**
 * 有 updatedProject 时必须先 project.update 再 tool.completed。
 * 否则 handler 会先 canvas.sync 把空盘刷回客户端。
 */
export function approvedToolResultEventOrder(hasUpdatedProject: boolean): string[] {
  return hasUpdatedProject
    ? ["project.update", "tool.completed"]
    : ["tool.completed"];
}

/** 生图工具完成时不要立刻 canvas.sync，占位图靠 project.update */
export function shouldCanvasSyncOnToolCompleted(toolName: string | undefined): boolean {
  return !isCanvasImageTool(toolName);
}
