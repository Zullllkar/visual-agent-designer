import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InspectorProjectSummary } from "./inspector-project-summary";

describe("InspectorProjectSummary", () => {
  it("renders a long visual style as wrapped detail instead of a mood chip", () => {
    const html = renderToStaticMarkup(
      createElement(InspectorProjectSummary, {
        title: "远协",
        description: "我要开发一个 web 网站，是一个远程工具官网",
        targetLabel: "界面视觉",
        visualStyle:
          "Dark minimal developer-tool SaaS landing with restrained typography and precise spacing",
      }),
    );

    expect(html).toContain('class="vad-inspector-style-value"');
    expect(html).toContain("Dark minimal developer-tool SaaS");
    expect(html).not.toContain('class="vad-inspector-mood">Dark minimal developer-tool SaaS');
  });

  it("shows the pending brief state without an empty style block", () => {
    const html = renderToStaticMarkup(
      createElement(InspectorProjectSummary, {
        title: "未命名项目",
        description: "还没有原始想法，可在右侧对话里补上。",
        targetLabel: "待补 Brief",
      }),
    );

    expect(html).toContain("待补 Brief");
    expect(html).not.toContain("vad-inspector-style");
  });
});
