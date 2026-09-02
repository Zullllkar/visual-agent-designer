/**
 * Agent 侧栏 Markdown 预处理
 * --------------------------------------------------------------
 * 模型常把整段报告塞进 ```text，或用空格「画」两列表格；
 * 窄栏下会变成 TXText 代码块 + 错位伪表。这里先摊平再渲染。
 */

const PROSE_FENCE_LANG =
  /^(?:text|plaintext|plain|markdown|md|txt)?$/i;

export function looksLikeProseBlock(body: string): boolean {
  const text = body.trim();
  if (!text) return false;

  const hasCjk = /[\u4e00-\u9fff]/.test(text);
  const hasMd =
    /^#{1,6}\s/m.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /^[-*+]\s+/m.test(text) ||
    /^>/m.test(text);
  const hasReportChrome =
    /[🔴🟠🟢🔵✅❌⚠️]/u.test(text) ||
    /[─━═]{3,}/.test(text) ||
    /[█░]{3,}/.test(text) ||
    /\s{2,}\S+/.test(text); // 空格伪表

  const codeHits =
    (text.match(/[{};]/g)?.length ?? 0) +
    (text.match(/\b(?:const|let|function|import|export|return|class)\b/g)
      ?.length ?? 0) *
      4;

  // 中文报告 / Markdown 文档：优先当正文，别进代码壳
  if ((hasCjk || hasMd || hasReportChrome) && codeHits < 16) return true;
  if (text.length < 40 && !hasCjk) return false;
  return false;
}

/** 拆掉误包整段报告的 ```text / ```markdown 围栏 */
export function unwrapProseFences(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(
    /```([^\n`]*)\n([\s\S]*?)\n```/g,
    (full, info: string, body: string) => {
      const lang = (info || "").trim().split(/\s+/)[0] || "";
      if (!PROSE_FENCE_LANG.test(lang)) return full;
      if (!looksLikeProseBlock(body)) return full;
      return `\n${body.trimEnd()}\n`;
    }
  );
}

function splitWideColumns(line: string): [string, string] | null {
  const match = line.match(/^(\S(?:.*?\S)?)\s{2,}(\S.*)$/);
  if (!match) return null;
  const left = match[1].trim();
  const right = match[2].trim();
  if (!left || !right) return null;
  // 避免把普通句子（词间单空格）误拆；要求中间空隙够宽
  if (left.length > 40) return null;
  return [left, right];
}

function isColumnHeaderRow(line: string): boolean {
  const cols = splitWideColumns(line);
  if (!cols) return false;
  const [left, right] = cols;
  // 「页面 / 为什么致命」这类短表头
  return left.length <= 12 && right.length <= 16;
}

function isColumnDataRow(line: string): boolean {
  if (!line.trim() || /^#{1,6}\s/.test(line) || /^[-*_]{3,}\s*$/.test(line)) {
    return false;
  }
  if (/^[🔴🟠🟢🔵✅❌⚠️]/u.test(line.trim())) return false;
  return splitWideColumns(line) != null;
}

/**
 * 把「页面····为什么致命」空格伪表转成列表，适配窄侧栏。
 */
export function convertSpaceColumnsToLists(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (
      isColumnHeaderRow(line) &&
      i + 1 < lines.length &&
      isColumnDataRow(lines[i + 1])
    ) {
      i += 1; // 跳过表头
      while (i < lines.length && isColumnDataRow(lines[i])) {
        const cols = splitWideColumns(lines[i]);
        if (!cols) break;
        const [left, right] = cols;
        out.push(`- **${left}** — ${right}`);
        i += 1;
      }
      continue;
    }
    out.push(line);
    i += 1;
  }

  return out.join("\n");
}

export function isProseFenceLanguage(language: string): boolean {
  return PROSE_FENCE_LANG.test(language.trim());
}

/** Agent 消息渲染前规范化 */
export function normalizeAgentMarkdown(content: string): string {
  let text = unwrapProseFences(content);
  text = convertSpaceColumnsToLists(text);
  return text;
}
