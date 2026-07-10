/**
 * 简易代码 diff 行（Chat 时间线展示用）
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

export type DiffLineKind = "add" | "remove" | "same";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface CodeDiffPayload {
  path: string;
  language?: string;
  oldText?: string;
  newText?: string;
  summary?: string;
}

/** 按行对比（LCS 简化：仅标记新增/删除行，适合小片段） */
export function buildDiffLines(
  oldText?: string,
  newText?: string,
  maxLines = 48
): DiffLine[] {
  const oldLines = (oldText ?? "").split("\n");
  const newLines = (newText ?? "").split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const out: DiffLine[] = [];

  for (const line of oldLines) {
    if (!newSet.has(line) && line.trim()) {
      out.push({ kind: "remove", text: line });
    }
  }
  for (const line of newLines) {
    if (!oldSet.has(line) && line.trim()) {
      out.push({ kind: "add", text: line });
    } else if (oldSet.has(line) && line.trim()) {
      out.push({ kind: "same", text: line });
    }
  }

  if (out.length > maxLines) {
    return [
      ...out.slice(0, maxLines),
      { kind: "same", text: `… 另有 ${out.length - maxLines} 行未展示` },
    ];
  }
  return out.length ? out : [{ kind: "same", text: "(无文本差异，可能为结构更新)" }];
}

export function guessLanguage(path: string): string {
  if (path.endsWith(".json") || path.endsWith(".canvas.json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".html")) return "html";
  return "text";
}

export function truncateForDiff(text: string, max = 2400): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n… (已截断)";
}
