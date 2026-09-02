/**
 * execute 工具
 * --------------------------------------------------------------
 * Agent 可执行代码片段（JavaScript/TypeScript），用于计算、数据处理等。
 * 在安全沙箱中运行，限制执行时间和可用 API。
 */

import { createHash } from "node:crypto";
import type { AgentTool, ToolContext, ToolResult } from "./types";

export const executeTool: AgentTool = {
  name: "execute",
  description:
    "执行 JavaScript/TypeScript 代码片段，用于数学计算、数据处理、格式转换等。不支持文件系统或网络操作。",
  riskLevel: "moderate",
  requiresConfirmation: true,
  timeoutMs: 10_000,
  parameters: {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: ["javascript", "typescript"],
        description: "代码语言（默认 javascript）",
      },
      code: {
        type: "string",
        description: "要执行的代码片段",
      },
      timeout: {
        type: "number",
        description: "超时时间（毫秒），默认 5000",
      },
    },
    required: ["code"],
  },

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext
  ): Promise<ToolResult> {
    const code = args.code as string;
    const timeout = (args.timeout as number) ?? 5000;

    if (!code) throw new Error("execute 操作需要 code 参数");
    if (code.length > 10000) throw new Error("代码片段过长（上限 10000 字符）");

    // 安全检查：禁止危险操作
    const dangerous = [
      /require\s*\(/,
      /import\s+/,
      /process\./,
      /child_process/,
      /__dirname/,
      /__filename/,
      /eval\s*\(/,
      /Function\s*\(/,
      /\bfs\b/,
      /\bnet\b/,
      /\bhttp\b/,
      /\bhttps\b/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /globalThis/,
      /global\./,
      /window\./,
      /document\./,
      /\bBuffer\b/,
      /stream\./,
      /os\./,
      /dns\./,
      /cluster\./,
      /worker_threads/,
      /sharedarraybuffer/i,
    ];
    for (const pattern of dangerous) {
      if (pattern.test(code)) {
        return {
          summary: `代码执行被拒绝：包含禁止的操作 (${pattern.source})`,
          data: { error: "forbidden_operation", pattern: pattern.source },
        };
      }
    }

    try {
      const result = await runSandboxed(code, timeout);
      return {
        summary: `代码执行成功，返回类型: ${typeof result}`,
        data: {
          result: serializeResult(result),
          type: typeof result,
        },
      };
    } catch (e) {
      return {
        summary: `代码执行失败: ${(e as Error).message}`,
        data: { error: (e as Error).message },
      };
    }
  },

  async fallback(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    return this.execute(args, ctx);
  },
};

async function runSandboxed(code: string, timeoutMs: number): Promise<unknown> {
  const wrapped = `
    (function() {
      "use strict";
      ${code}
    })()
  `;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`代码执行超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    try {
      const vm = require("node:vm");
      const context = vm.createContext({
        Math,
        JSON,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Map,
        Set,
        RegExp,
        Error,
        console: { log: () => {}, error: () => {}, warn: () => {} },
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        crypto: { createHash },
      });
      const script = new vm.Script(wrapped, {
        timeout: timeoutMs,
        filename: "sandbox.js",
      });
      const result = script.runInContext(context, {
        timeout: timeoutMs,
        breakOnSigint: true,
        microtaskMode: "afterEvaluate",
      });
      clearTimeout(timer);
      resolve(result);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

function serializeResult(result: unknown): unknown {
  if (result === undefined) return null;
  if (result === null) return null;
  if (typeof result === "function") return "[Function]";
  try {
    JSON.stringify(result);
    return result;
  } catch {
    return String(result);
  }
}
