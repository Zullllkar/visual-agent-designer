/**
 * Cursor 深链（浏览器安全）
 * --------------------------------------------------------------
 * 只做字符串拼装，不依赖 node:path / Buffer，可被客户端组件直接引用。
 * 需要 Node 能力的安装计划仍在 install-planner.ts。
 */

/** cursor://anysphere.cursor-deeplink/prompt?text=…（≤8000 字符，用户需确认才执行） */
export function cursorPromptDeeplink(text: string): string {
  const clipped = text.length > 1800 ? `${text.slice(0, 1797)}...` : text;
  const url = new URL("cursor://anysphere.cursor-deeplink/prompt");
  url.searchParams.set("text", clipped);
  return url.toString();
}
