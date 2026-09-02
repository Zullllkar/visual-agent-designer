/**
 * file_system 工具
 * --------------------------------------------------------------
 * Agent 对项目 .vad 目录的文件操作：ls, read, write, glob, grep。
 * 包装 storage.ts 的安全 API，限制在项目目录内操作。
 */

import type { AgentTool, ToolContext, ToolResult } from "./types";
import {
  listProjectFileTree,
  readProjectFile,
  writeProjectFile,
} from "@/lib/vad/storage";
import type { VadFileNode } from "@/lib/vad/types";

export const fileSystemTool: AgentTool = {
  name: "file_system",
  description:
    "项目文件操作：ls（列目录树）、read（读文件）、write（写文件）、glob（模式匹配搜索文件名）、grep（内容搜索）",
  riskLevel: "moderate",
  requiresConfirmation: true,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["ls", "read", "write", "glob", "grep"],
        description: "操作类型",
      },
      path: {
        type: "string",
        description: "read/write: 相对路径; glob: glob 模式; grep: 搜索内容",
      },
      content: { type: "string", description: "write: 文件内容" },
      pattern: { type: "string", description: "glob: 文件名 glob 模式 (如 **/*.md)" },
      query: { type: "string", description: "grep: 搜索文本" },
      maxResults: { type: "number", description: "grep/glob 最大返回数" },
    },
    required: ["action"],
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const projectId = ctx.agentCtx.projectId;
    const action = args.action as string;

    if (action === "ls") {
      return doLs(projectId);
    }

    if (action === "read") {
      return doRead(projectId, args.path as string);
    }

    if (action === "write") {
      return doWrite(projectId, args.path as string, args.content as string);
    }

    if (action === "glob") {
      return doGlob(projectId, args.pattern as string, (args.maxResults as number) ?? 50);
    }

    if (action === "grep") {
      return doGrep(projectId, args.query as string, (args.maxResults as number) ?? 30);
    }

    return { summary: `未知文件操作: ${action}` };
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};

async function doLs(projectId: string): Promise<ToolResult> {
  const tree = await listProjectFileTree(projectId);
  const flat = flattenTree(tree);
  return {
    summary: `项目目录: ${flat.length} 个文件`,
    data: { files: flat },
  };
}

async function doRead(projectId: string, relPath: string): Promise<ToolResult> {
  if (!relPath) throw new Error("read 操作需要 path 参数");
  try {
    const content = await readProjectFile(projectId, relPath);
    const truncated = content.length > 8000
      ? content.slice(0, 8000) + "\n... (截断，总长 " + content.length + " 字符)"
      : content;
    return {
      summary: `读取 ${relPath} (${content.length} 字符)`,
      data: { path: relPath, content: truncated, size: content.length },
    };
  } catch (e) {
    return {
      summary: `读取失败: ${(e as Error).message}`,
    };
  }
}

async function doWrite(
  projectId: string,
  relPath: string,
  content: string
): Promise<ToolResult> {
  if (!relPath) throw new Error("write 操作需要 path 参数");
  if (content === undefined) throw new Error("write 操作需要 content 参数");
  try {
    await writeProjectFile(projectId, relPath, content);
    return {
      summary: `写入 ${relPath} (${content.length} 字符)`,
      fileWrites: [relPath],
    };
  } catch (e) {
    return {
      summary: `写入失败: ${(e as Error).message}`,
    };
  }
}

async function doGlob(
  projectId: string,
  pattern: string,
  maxResults: number
): Promise<ToolResult> {
  if (!pattern) throw new Error("glob 操作需要 pattern 参数");
  const tree = await listProjectFileTree(projectId);
  const allFiles = flattenTree(tree);
  const regex = globToRegex(pattern);
  const matched = allFiles.filter((f) => regex.test(f)).slice(0, maxResults);
  return {
    summary: `glob "${pattern}": 匹配 ${matched.length} 个文件`,
    data: { pattern, matches: matched },
  };
}

async function doGrep(
  projectId: string,
  query: string,
  maxResults: number
): Promise<ToolResult> {
  if (!query) throw new Error("grep 操作需要 query 参数");
  const tree = await listProjectFileTree(projectId);
  const allFiles = flattenTree(tree);
  const results: Array<{ path: string; line: number; text: string }> = [];
  const lowerQuery = query.toLowerCase();

  for (const filePath of allFiles) {
    if (results.length >= maxResults) break;
    try {
      const content = await readProjectFile(projectId, filePath);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({
            path: filePath,
            line: i + 1,
            text: lines[i].trim().slice(0, 200),
          });
          if (results.length >= maxResults) break;
        }
      }
    } catch {
      // 跳过不可读文件
    }
  }

  return {
    summary: `grep "${query}": 找到 ${results.length} 个匹配`,
    data: { query, matches: results },
  };
}

function flattenTree(nodes: VadFileNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "file") {
      out.push(node.path);
    } else if (node.kind === "directory" && node.children) {
      out.push(...flattenTree(node.children));
    }
  }
  return out;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(escaped, "i");
}
