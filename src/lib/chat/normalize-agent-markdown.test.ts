import { describe, expect, it } from "vitest";
import {
  convertSpaceColumnsToLists,
  looksLikeProseBlock,
  normalizeAgentMarkdown,
  unwrapProseFences,
} from "./normalize-agent-markdown";

describe("unwrapProseFences", () => {
  it("unwraps a whole-document text fence", () => {
    const input = "```text\n# 标题\n\n**加粗** 内容说明一下\n```";
    const out = unwrapProseFences(input);
    expect(out).toContain("# 标题");
    expect(out).not.toContain("```");
  });

  it("keeps real code fences", () => {
    const input = "```ts\nconst a = 1;\n```";
    expect(unwrapProseFences(input)).toContain("```ts");
  });
});

describe("convertSpaceColumnsToLists", () => {
  it("converts space-aligned two-column blocks", () => {
    const input = [
      "🔴 **P0 · 测试**",
      "页面                    为什么致命",
      "资源详情页 Arsenal      能浏览不能下载",
      "注册页                  没有账号就流失",
      "",
      "下文",
    ].join("\n");
    const out = convertSpaceColumnsToLists(input);
    expect(out).toContain("- **资源详情页 Arsenal** — 能浏览不能下载");
    expect(out).toContain("- **注册页** — 没有账号就流失");
    expect(out).not.toContain("为什么致命");
  });
});

describe("normalizeAgentMarkdown", () => {
  it("unwraps and converts in one pass", () => {
    const input = [
      "```text",
      "# 诊断",
      "",
      "页面          原因",
      "首页          缺转化",
      "```",
    ].join("\n");
    const out = normalizeAgentMarkdown(input);
    expect(looksLikeProseBlock(out)).toBe(true);
    expect(out).toContain("- **首页** — 缺转化");
    expect(out).not.toContain("```");
  });
});
