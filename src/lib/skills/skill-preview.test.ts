import { describe, expect, it } from "vitest";
import {
  skillCardTitle,
  skillDocumentTitle,
  splitSkillDocument,
  yamlPreviewSegments,
} from "./skill-preview";

const sample = `---
name: web-prototype
description: 生成多页产品原型
---

# Web 产品原型

正文从这里开始。
`;

describe("splitSkillDocument", () => {
  it("splits yaml frontmatter from markdown", () => {
    expect(splitSkillDocument(sample)).toEqual({
      yaml: "name: web-prototype\ndescription: 生成多页产品原型",
      markdown: "# Web 产品原型\n\n正文从这里开始。",
    });
  });

  it("treats documents without frontmatter as markdown", () => {
    expect(splitSkillDocument("# Hello")).toEqual({ yaml: "", markdown: "# Hello" });
  });
});

describe("skillDocumentTitle", () => {
  it("prefers the first markdown heading", () => {
    expect(skillDocumentTitle(sample, "fallback")).toBe("Web 产品原型");
  });
});

describe("yamlPreviewSegments", () => {
  it("colors keys and values", () => {
    const segments = yamlPreviewSegments("name: demo\ndescription: |");
    expect(
      segments.some((segment) => segment.className === "is-key" && segment.text === "name"),
    ).toBe(true);
    expect(
      segments.some((segment) => segment.className === "is-val" && segment.text.includes("demo")),
    ).toBe(true);
  });
});

describe("skillCardTitle", () => {
  it("uses the preview heading when present", () => {
    expect(
      skillCardTitle({
        name: "web-prototype",
        description: "很长的一段说明文字用来当简介",
        bodyPreview: "# Web 产品原型\n说明",
      }),
    ).toBe("Web 产品原型");
  });
});
