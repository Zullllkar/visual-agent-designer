#!/usr/bin/env node

/**
 * Visual Agent Designer - Local MCP Server & CLI Tool
 * --------------------------------------------------------------
 * 参考 Open Design 架构，作为一个标准 Model Context Protocol (MCP) 服务运行。
 * 支持 Stdio 双向通信，可一键注入 Claude Code、Cursor、Claude Desktop。
 * 
 * 主要职责：
 *   1. 作为一个本地 stdio 进程，暴露 Visual Agent Designer 画布中的最新设计上下文。
 *   2. 允许终端中的 claude、codex 或 Cursor 中的 AI 助理跨目录直接读取当前画布的 
 *      产品规范 (SPEC.md)、设计 tokens.json 和高保真 SVG 视觉稿，完成 1:1 精确写码。
 * 
 * 运行命令: node cli.js mcp
 */

const fs = require("node:fs").promises;
const path = require("node:path");

const VAD_DIR = path.join(process.cwd(), ".vad", "projects");

/**
 * 扫描本地的所有项目，按更新时间倒序排序
 */
async function getSortedProjects() {
  try {
    const dirs = await fs.readdir(VAD_DIR);
    const projects = [];
    for (const dir of dirs) {
      const projectJsonPath = path.join(VAD_DIR, dir, "project.json");
      try {
        const raw = await fs.readFile(projectJsonPath, "utf8");
        projects.push(JSON.parse(raw));
      } catch {}
    }
    return projects.sort((a, b) => {
      const timeA = a.updatedAt || "";
      const timeB = b.updatedAt || "";
      return timeB.localeCompare(timeA);
    });
  } catch (err) {
    return [];
  }
}

/**
 * 读取项目 Handoff 中的特定文件
 */
async function readProjectHandoffFile(projectId, relPath) {
  const filePath = path.join(VAD_DIR, projectId, "handoff", relPath);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 列出 Handoff 下的所有文件列表
 */
async function listProjectHandoffFiles(projectId, subDir = "") {
  const dirPath = path.join(VAD_DIR, projectId, "handoff", subDir);
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    let files = [];
    for (const item of items) {
      const rel = path.join(subDir, item.name);
      if (item.isDirectory()) {
        const subFiles = await listProjectHandoffFiles(projectId, rel);
        files = files.concat(subFiles);
      } else {
        files.push(rel.replace(/\\/g, "/"));
      }
    }
    return files;
  } catch {
    return [];
  }
}

// ==========================================
// MCP Standard Handler (Stdio JSON-RPC 2.0)
// ==========================================

async function handleMcpMode() {
  // 禁止 stdout 输出除 JSON-RPC 响应外的任何内容
  const originalConsoleLog = console.log;
  console.log = console.error; // 重定向 console.log 到 stderr

  let buffer = "";

  process.stdin.on("data", async (chunk) => {
    buffer += chunk.toString();
    
    let lineEndIndex;
    while ((lineEndIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, lineEndIndex).trim();
      buffer = buffer.slice(lineEndIndex + 1);
      
      if (!line) continue;
      
      try {
        const request = JSON.parse(line);
        await processMcpRequest(request);
      } catch (err) {
        sendMcpError(null, -32700, "Parse error: " + err.message);
      }
    }
  });
}

function sendMcpResponse(id, result) {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id,
    result,
  });
  process.stdout.write(payload + "\n");
}

function sendMcpNotification(method, params) {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params,
  });
  process.stdout.write(payload + "\n");
}

function sendMcpError(id, code, message) {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  process.stdout.write(payload + "\n");
}

async function processMcpRequest(req) {
  const { id, method, params } = req;
  
  if (method === "initialize") {
    return sendMcpResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        resources: {},
        tools: {},
      },
      serverInfo: {
        name: "visual-agent-designer-mcp",
        version: "1.0.0",
      },
    });
  }
  
  if (method === "notifications/initialized") {
    return; // 无需回应
  }

  // ==========================================
  // Resources (MCP 静态资源列表与读取)
  // ==========================================
  if (method === "resources/list") {
    const projects = await getSortedProjects();
    const resources = [];

    if (projects.length > 0) {
      const latest = projects[0];
      resources.push({
        uri: "vad://projects/latest/spec",
        name: `Latest Project Spec (${latest.title})`,
        mimeType: "text/markdown",
        description: "The product requirements document (SPEC.md) of the most recently updated design.",
      });
      resources.push({
        uri: "vad://projects/latest/tokens",
        name: "Latest Project Design Tokens",
        mimeType: "application/json",
        description: "Standard design system tokens (colors, font sizes, corners) of the active canvas.",
      });
    }

    return sendMcpResponse(id, { resources });
  }

  if (method === "resources/read") {
    const uri = params?.uri;
    const projects = await getSortedProjects();
    if (projects.length === 0) {
      return sendMcpError(id, -32602, "No projects found on local disk.");
    }
    const latest = projects[0];

    if (uri === "vad://projects/latest/spec") {
      const spec = await readProjectHandoffFile(latest.id, "SPEC.md");
      if (!spec) return sendMcpError(id, 404, "SPEC.md not found for latest project.");
      return sendMcpResponse(id, {
        contents: [{ uri, mimeType: "text/markdown", text: spec }],
      });
    }

    if (uri === "vad://projects/latest/tokens") {
      const tokens = await readProjectHandoffFile(latest.id, "design/tokens.json");
      if (!tokens) return sendMcpError(id, 404, "design/tokens.json not found for latest project.");
      return sendMcpResponse(id, {
        contents: [{ uri, mimeType: "application/json", text: tokens }],
      });
    }

    return sendMcpError(id, 404, `Resource uri ${uri} not found.`);
  }

  // ==========================================
  // Tools (MCP 主动函数调用)
  // ==========================================
  if (method === "tools/list") {
    return sendMcpResponse(id, {
      tools: [
        {
          name: "get_latest_project",
          description: "Retrieve the active designed project's SPEC.md, design tokens, and lists of page SVGs and layouts on the visual canvas.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_page_assets",
          description: "Get the high-fidelity SVG graphic string and layout layers JSON of a specific canvas page. Perfect for UI 1:1 replica development.",
          inputSchema: {
            type: "object",
            properties: {
              pageSlug: {
                type: "string",
                description: "The name slug of the page, e.g. 'home-page' or 'onboarding'. Can be scanned from get_latest_project output.",
              },
            },
            required: ["pageSlug"],
          },
        },
      ],
    });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const projects = await getSortedProjects();
    if (projects.length === 0) {
      return sendMcpResponse(id, {
        content: [{ type: "text", text: "No visual designer projects found. Please create a design first in the web UI." }],
        isError: true,
      });
    }
    const latest = projects[0];

    if (toolName === "get_latest_project") {
      const spec = (await readProjectHandoffFile(latest.id, "SPEC.md")) || "No SPEC.md generated.";
      const readme = (await readProjectHandoffFile(latest.id, "README.md")) || "No README.md.";
      const tokens = (await readProjectHandoffFile(latest.id, "design/tokens.json")) || "{}";
      const files = await listProjectHandoffFiles(latest.id);
      
      const responseText = [
        `# Active Project: ${latest.title}`,
        `**Raw User Idea**: ${latest.rawIdea}`,
        `**Last Updated**: ${latest.updatedAt}`,
        "",
        "## Product Specification (SPEC.md)",
        "```markdown",
        spec,
        "```",
        "",
        "## Design Tokens (tokens.json)",
        "```json",
        tokens,
        "```",
        "",
        "## Available Page Asset Files",
        files.filter(f => f.startsWith("design/pages/")).map(f => `- \`${f}\``).join("\n"),
        "",
        "Use \`get_page_assets\` with the page name to read the high-fidelity SVG or layers layout JSON."
      ].join("\n");

      return sendMcpResponse(id, {
        content: [{ type: "text", text: responseText }],
      });
    }

    if (toolName === "get_page_assets") {
      const pageSlug = toolArgs.pageSlug;
      const cleanSlug = pageSlug.replace(/\.(svg|canvas\.json)$/, "").replace(/^design\/pages\//, "");
      
      const svgRelPath = `design/pages/${cleanSlug}.svg`;
      const jsonRelPath = `design/pages/${cleanSlug}.canvas.json`;

      const svgContent = await readProjectHandoffFile(latest.id, svgRelPath);
      const jsonContent = await readProjectHandoffFile(latest.id, jsonRelPath);

      if (!svgContent) {
        return sendMcpResponse(id, {
          content: [{ type: "text", text: `Page asset matching "${pageSlug}" was not found.` }],
          isError: true,
        });
      }

      const results = [
        `### Page: ${cleanSlug}`,
        "",
        `#### 1. High-fidelity Vector Visual SVG (\`${svgRelPath}\`)`,
        "This SVG represents the exact pixel-perfect design layout. Use it for styling, positioning, and visual reference:",
        "```xml",
        svgContent,
        "```",
      ];

      if (jsonContent) {
        results.push(
          "",
          `#### 2. Layout Structure Layers JSON (\`${jsonRelPath}\`)`,
          "This contains structural layers, text blocks content, and configurations:",
          "```json",
          jsonContent,
          "```"
        );
      }

      return sendMcpResponse(id, {
        content: [{ type: "text", text: results.join("\n") }],
      });
    }

    return sendMcpError(id, -32601, `Tool method ${toolName} not supported.`);
  }

  return sendMcpError(id, -32601, `Method ${method} not found.`);
}

// ==========================================
// CLI Routing Entry
// ==========================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  if (command === "mcp") {
    await handleMcpMode();
  } else if (command === "list") {
    const projects = await getSortedProjects();
    if (projects.length === 0) {
      console.log("No projects found under .vad/projects/");
      return;
    }
    console.log("=== Active Visual Agent Designer Projects ===");
    projects.forEach((p, i) => {
      console.log(`${i + 1}. [${p.id}] ${p.title} (${p.updatedAt})`);
      console.log(`   Idea: ${p.rawIdea}`);
    });
  } else {
    console.log("=== Visual Agent Designer Local CLI Tool ===");
    console.log("Usage:");
    console.log("  node cli.js list    - List all active designer projects on local disk");
    console.log("  node cli.js mcp     - Run stdio Model Context Protocol (MCP) server");
    console.log("                        (Injects visual design contexts into Claude Code / Cursor)");
  }
}

main().catch((err) => {
  console.error("CLI runtime error:", err);
  process.exit(1);
});
