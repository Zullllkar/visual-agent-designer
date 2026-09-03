/**
 * 受管 Markdown 片段
 * --------------------------------------------------------------
 * 用 HTML 注释标记包裹 Vibeboard 写入的说明，upsert 时只替换标记内
 * 内容，绝不覆盖用户自己写的 AGENTS.md / CLAUDE.md。
 */

export const MARKER_START = "<!-- vibeboard:start -->";
export const MARKER_END = "<!-- vibeboard:end -->";

export function upsertManagedSnippet(existing: string | null | undefined, body: string): string {
  const block = `${MARKER_START}\n${body.trim()}\n${MARKER_END}`;
  if (!existing || !existing.trim()) return `${block}\n`;
  const start = existing.indexOf(MARKER_START);
  const end = existing.indexOf(MARKER_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + MARKER_END.length);
  }
  const prefix = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${prefix}\n${block}\n`;
}

export function removeManagedSnippet(existing: string | null | undefined): string | null {
  if (existing == null) return null;
  const start = existing.indexOf(MARKER_START);
  const end = existing.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end < start) return existing;
  const before = existing.slice(0, start).replace(/[ \t]+$/u, "").replace(/\n{2,}$/u, "\n");
  const after = existing.slice(end + MARKER_END.length).replace(/^\n+/, "\n");
  const joined = (before + after).replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
  return joined.trim() ? `${joined.replace(/\n+$/, "")}\n` : "";
}

export function hasManagedSnippet(existing: string | null | undefined): boolean {
  if (!existing) return false;
  const start = existing.indexOf(MARKER_START);
  const end = existing.indexOf(MARKER_END);
  return start !== -1 && end > start;
}

export function designTruthSnippet(mountDir: string): string {
  const dir = mountDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return [
    `This repo is linked to a **Vibeboard** design project.`,
    ``,
    `Design source of truth lives in \`${dir}/\` (README, DESIGN, SPEC, LAYOUT, tokens, final mockups).`,
    `A \`vibeboard\` MCP server is also available — call \`get_handoff\` / \`get_asset_image\` / \`get_layout_ir\` for live context from the running app.`,
    ``,
    `Do not invent screens that have no matching file under \`${dir}/assets/final/\`.`,
    `When a screen is implemented, prefer calling the Vibeboard MCP tool \`report_implementation\` (if available) so the designer can review it.`,
  ].join("\n");
}

export function cursorRuleFile(mountDir: string): string {
  return [
    "---",
    "description: Vibeboard design source of truth for this repo",
    "alwaysApply: true",
    "---",
    "",
    MARKER_START,
    designTruthSnippet(mountDir),
    MARKER_END,
    "",
  ].join("\n");
}
