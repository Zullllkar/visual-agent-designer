/**
 * Workspace Rules 系统
 * --------------------------------------------------------------
 * 从 .vad/rules/ 目录加载项目级规则，注入 Agent 系统提示词。
 * 支持规则文件格式：.md（Markdown 规则描述）
 *
 * 规则文件结构：
 * .vad/rules/
 *   ├── design.md       — 设计规范规则
 *   ├── brand.md        — 品牌一致性规则
 *   ├── workflow.md     — 工作流规则
 *   └── custom.md       — 自定义规则
 */

import "server-only";

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { projectDir } from "@/lib/vad/paths";
import { ensureDir } from "@/lib/vad/persist";

/** 单条规则 */
export interface WorkspaceRule {
  /** 规则文件名（不含扩展名） */
  id: string;
  /** 规则标题（从 Markdown H1 提取） */
  title: string;
  /** 规则内容（Markdown 原文） */
  content: string;
  /** 规则优先级（数字越大优先级越高） */
  priority: number;
}

/** 从 .vad/rules/ 加载所有规则 */
export async function loadWorkspaceRules(
  projectId: string
): Promise<WorkspaceRule[]> {
  const rulesDir = join(projectDir(projectId), "rules");
  try {
    await fs.access(rulesDir);
  } catch {
    return [];
  }

  const files = await fs.readdir(rulesDir);
  const rules: WorkspaceRule[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const id = file.replace(/\.md$/, "");
    try {
      const content = await fs.readFile(join(rulesDir, file), "utf8");
      const title = extractTitle(content) || id;
      const priority = extractPriority(content);
      rules.push({ id, title, content, priority });
    } catch {
      // 跳过不可读文件
    }
  }

  return rules.sort((a, b) => b.priority - a.priority);
}

/** 将规则格式化为系统提示词片段 */
export function formatRulesForPrompt(rules: WorkspaceRule[]): string {
  if (rules.length === 0) return "";

  const sections = rules.map((rule) => {
    return `### ${rule.title}\n\n${rule.content.trim()}`;
  });

  return `## Workspace Rules\n\n以下是项目级规则，请在设计和生成时严格遵守：\n\n${sections.join("\n\n")}`;
}

/** 创建/更新规则文件 */
export async function saveRule(
  projectId: string,
  ruleId: string,
  content: string
): Promise<void> {
  const rulesDir = join(projectDir(projectId), "rules");
  await ensureDir(rulesDir);
  await fs.writeFile(join(rulesDir, `${ruleId}.md`), content, "utf8");
}

/** 删除规则文件 */
export async function deleteRule(
  projectId: string,
  ruleId: string
): Promise<void> {
  try {
    await fs.unlink(join(projectDir(projectId), "rules", `${ruleId}.md`));
  } catch {
    // 文件不存在，忽略
  }
}

/** 从 Markdown 内容提取 H1 标题 */
function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

/** 从 Markdown 内容提取优先级（frontmatter 中的 priority 字段） */
function extractPriority(content: string): number {
  const match = content.match(/^---[\s\S]*?priority:\s*(\d+)/m);
  return match ? parseInt(match[1], 10) : 0;
}
