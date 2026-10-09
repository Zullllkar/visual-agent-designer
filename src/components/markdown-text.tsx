"use client";

/**
 * Agent 侧栏 Markdown — Cursor 风渲染
 * 表格 / 标题层级 / 列表 / 围栏代码（文件头 + 行号 + diff 着色）
 */ //        */

import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  countDiffStats,
  languageBadge,
  parseCodeFenceMeta,
} from "@/lib/chat/markdown-fence";
import {
  isProseFenceLanguage,
  looksLikeProseBlock,
  normalizeAgentMarkdown,
} from "@/lib/chat/normalize-agent-markdown";

interface MarkdownTextProps {
  content: string;
  className?: string;
}

type DiffKind = "add" | "remove" | "context";

function classifyDiffLine(line: string): DiffKind {
  if (/^\+[^+]/.test(line) || line === "+") return "add";
  if (/^-[^-]/.test(line) || line === "-") return "remove";
  return "context";
}

function MdPlainBlock({ code }: { code: string }) {
  return (
    <pre className="vad-md-plain">
      <code>{code.replace(/\n$/, "")}</code>
    </pre>
  );
}

function MdFencedCode({
  className,
  code,
}: {
  className?: string;
  code: string;
}) {
  const meta = useMemo(() => parseCodeFenceMeta(className), [className]);
  const body = code.replace(/\n$/, "");
  const lines = body.length ? body.split("\n") : [""];
  const stats = useMemo(() => countDiffStats(body), [body]);
  const showChrome = Boolean(
    meta.filepath ||
      stats.added > 0 ||
      stats.removed > 0 ||
      (!isProseFenceLanguage(meta.language) && meta.language !== "text")
  );
  const showLines = showChrome && lines.length > 1;
  const title = meta.filename || meta.filepath || meta.language;
  const badge = languageBadge(meta.language);

  // 误包的 prose / ASCII 报告：不要套 TXText 代码壳
  if (
    !meta.filepath &&
    isProseFenceLanguage(meta.language) &&
    looksLikeProseBlock(body)
  ) {
    return <MarkdownTextImpl content={body} />;
  }

  if (!showChrome) {
    return <MdPlainBlock code={body} />;
  }

  return (
    <div className="vad-md-code">
      <div className="vad-md-code-header">
        <span className="vad-md-code-badge" aria-hidden>
          {badge}
        </span>
        {meta.filepath || meta.filename ? (
          <span className="vad-md-code-title" title={meta.filepath || title}>
            {meta.filename || meta.filepath}
          </span>
        ) : (
          <span className="vad-md-code-title vad-md-code-title--lang">
            {meta.language}
          </span>
        )}
        {stats.added > 0 || stats.removed > 0 ? (
          <span className="vad-md-code-stats">
            {stats.added > 0 ? (
              <span className="vad-md-code-stat-add">+{stats.added}</span>
            ) : null}
            {stats.removed > 0 ? (
              <span className="vad-md-code-stat-del">-{stats.removed}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="vad-md-code-body" role="region" aria-label={title}>
        <pre className="vad-md-code-pre">
          {lines.map((line, i) => {
            const kind = classifyDiffLine(line);
            return (
              <div
                key={`${i}-${kind}-${line.slice(0, 24)}`}
                className={
                  "vad-md-code-line" +
                  (kind === "add"
                    ? " vad-md-code-line--add"
                    : kind === "remove"
                      ? " vad-md-code-line--del"
                      : "")
                }
              >
                {showLines ? (
                  <span className="vad-md-code-ln" aria-hidden>
                    {i + 1}
                  </span>
                ) : null}
                <code className="vad-md-code-text">{line || " "}</code>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

function MarkdownTextImpl({ content, className = "" }: MarkdownTextProps) {
  const normalized = useMemo(
    () => normalizeAgentMarkdown(content),
    [content]
  );

  const components = useMemo(
    () => ({
      h1: ({ children }: { children?: ReactNode }) => (
        <h1 className="vad-md-h1">{children}</h1>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h2 className="vad-md-h2">{children}</h2>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h3 className="vad-md-h3">{children}</h3>
      ),
      h4: ({ children }: { children?: ReactNode }) => (
        <h4 className="vad-md-h4">{children}</h4>
      ),
      h5: ({ children }: { children?: ReactNode }) => (
        <h5 className="vad-md-h4">{children}</h5>
      ),
      h6: ({ children }: { children?: ReactNode }) => (
        <h6 className="vad-md-h4">{children}</h6>
      ),
      p: ({ children }: { children?: ReactNode }) => (
        <p className="vad-md-p">{children}</p>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul className="vad-md-ul">{children}</ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol className="vad-md-ol">{children}</ol>
      ),
      li: ({ children }: { children?: ReactNode }) => (
        <li className="vad-md-li">{children}</li>
      ),
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote className="vad-md-quote">{children}</blockquote>
      ),
      hr: () => <hr className="vad-md-hr" />,
      a: ({
        href,
        children,
      }: {
        href?: string;
        children?: ReactNode;
      }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="vad-md-a"
        >
          {children}
        </a>
      ),
      strong: ({ children }: { children?: ReactNode }) => (
        <strong className="vad-md-strong">{children}</strong>
      ),
      em: ({ children }: { children?: ReactNode }) => (
        <em className="vad-md-em">{children}</em>
      ),
      del: ({ children }: { children?: ReactNode }) => (
        <del className="vad-md-del">{children}</del>
      ),
      table: ({ children }: { children?: ReactNode }) => (
        <div className="vad-md-table-wrap">
          <table className="vad-md-table">{children}</table>
        </div>
      ),
      thead: ({ children }: { children?: ReactNode }) => (
        <thead className="vad-md-thead">{children}</thead>
      ),
      tbody: ({ children }: { children?: ReactNode }) => (
        <tbody>{children}</tbody>
      ),
      tr: ({ children }: { children?: ReactNode }) => (
        <tr className="vad-md-tr">{children}</tr>
      ),
      th: ({ children }: { children?: ReactNode }) => (
        <th className="vad-md-th">{children}</th>
      ),
      td: ({ children }: { children?: ReactNode }) => (
        <td className="vad-md-td">{children}</td>
      ),
      pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
      code: ({
        className: codeClass,
        children,
      }: {
        className?: string;
        children?: ReactNode;
      }) => {
        const text = String(children ?? "");
        const isBlock =
          Boolean(codeClass?.includes("language-")) || text.includes("\n");
        if (!isBlock) {
          return <code className="vad-md-inline-code">{children}</code>;
        }
        return <MdFencedCode className={codeClass} code={text} />;
      },
    }),
    []
  );

  return (
    <div className={`vad-md ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownText = memo(MarkdownTextImpl);
