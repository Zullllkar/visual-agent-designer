/**
 * Markdown 代码围栏元信息解析
 */

import { guessLanguage } from "./code-diff";

export interface CodeFenceMeta {
  language: string;
  filepath?: string;
  /** 展示用短文件名 */
  filename?: string;
}

/** 从 react-markdown 的 `language-xxx` class 解析语言 / 路径 */
export function parseCodeFenceMeta(className?: string | null): CodeFenceMeta {
  const full = String(className ?? "").trim();
  const langToken = full.match(/language-(\S+)(?:\s+(.+))?/);
  const raw = [langToken?.[1], langToken?.[2]].filter(Boolean).join(" ").trim();

  if (!raw) return { language: "text" };

  // Cursor 引用：```12:15:src/foo.tsx
  const cite = raw.match(/^\d+:\d+:(.+)$/);
  if (cite?.[1]) {
    const filepath = cite[1];
    return {
      language: guessLanguage(filepath),
      filepath,
      filename: filepath.split(/[/\\]/).pop() || filepath,
    };
  }

  // ```tsx src/foo.tsx 或 ```typescript:src/foo.tsx
  const spaced = raw.match(/^([\w.+#-]+)\s+(.+)$/);
  if (spaced) {
    const filepath = spaced[2].trim();
    return {
      language: spaced[1],
      filepath,
      filename: filepath.split(/[/\\]/).pop() || filepath,
    };
  }

  const colonPath = raw.match(/^([\w.+#-]+):(.+\.[a-zA-Z0-9]+)$/);
  if (colonPath) {
    const filepath = colonPath[2];
    return {
      language: colonPath[1],
      filepath,
      filename: filepath.split(/[/\\]/).pop() || filepath,
    };
  }

  // 纯路径
  if (/[/\\]/.test(raw) || /\.[a-zA-Z0-9]+$/.test(raw)) {
    return {
      language: guessLanguage(raw),
      filepath: raw,
      filename: raw.split(/[/\\]/).pop() || raw,
    };
  }

  return { language: raw || "text" };
}

export function countDiffStats(code: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of code.split("\n")) {
    if (/^\+[^+]/.test(line) || line === "+") added += 1;
    else if (/^-[^-]/.test(line) || line === "-") removed += 1;
  }
  return { added, removed };
}

export function languageBadge(language: string): string {
  const map: Record<string, string> = {
    typescript: "TS",
    ts: "TS",
    tsx: "TSX",
    javascript: "JS",
    js: "JS",
    jsx: "JSX",
    json: "JSON",
    markdown: "MD",
    md: "MD",
    css: "CSS",
    html: "HTML",
    python: "PY",
    shell: "SH",
    bash: "SH",
    text: "TXT",
    diff: "DIFF",
  };
  return map[language.toLowerCase()] ?? language.slice(0, 4).toUpperCase();
}
