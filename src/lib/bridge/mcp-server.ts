/**
 * Vibeboard Bridge — MCP Server
 * --------------------------------------------------------------
 * 工具与资源只在这里实现一次；传输层（Streamable HTTP / stdio 转发）
 * 各自 `createBridgeMcpServer()` 后 connect 即可。
 *
 * 阶段 1 覆盖"上下文 + 拉取"：
 *   get_active_context · list_projects · get_project
 *   get_handoff · read_handoff_file · list_handoff_files
 *   get_asset_image · get_layout_ir · get_kickoff_prompt
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { buildKickoffClipboardText } from "@/lib/handoff/kickoff-prompt";
import { resolveAssetImageDataUrl } from "@/lib/handoff/resolve-asset-src";
import { compressImageDataUrlForVision } from "@/lib/handoff/vision-image";
import type { ProjectFile } from "@/lib/project/schema";
import { listProjectsFromVad } from "@/lib/vad/storage";

import { activeContext } from "./active-context";
import { BRIDGE_SERVER_NAME } from "./config";
import {
  HANDOFF_PRIMARY_DOCS,
  getBuiltHandoff,
  type BuiltHandoff,
} from "./handoff-cache";
import { resolveProject, summarizeProject } from "./resolve-project";

export const BRIDGE_SERVER_VERSION = "0.1.0";

const SERVER_INSTRUCTIONS = [
  "Vibeboard is a local design studio. Its final visual assets, layout IR, tokens and specs are the design source of truth for the code you write.",
  "Start with get_active_context (or pass `project` explicitly), then call get_handoff once — it bundles README/DESIGN/SPEC/LAYOUT/tokens in one response. Prefer it over many read_handoff_file calls.",
  "Use get_asset_image to look at a final mockup as an image; use get_layout_ir for authoritative regions, copy and which regions must be rebuilt in code.",
  "Never invent a different visual system. Follow tokens, style lock and the don'ts in DESIGN.md.",
].join("\n");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const PROJECT_ARG = z
  .string()
  .optional()
  .describe(
    "Project id, slug, exact title, or unique title substring. Omit to use the project the user currently has open in Vibeboard."
  );

const DEFAULT_MAX_BYTES = 1_500_000;
const HARD_MAX_BYTES = 6_000_000;

export function createBridgeMcpServer(): McpServer {
  const server = new McpServer(
    { name: BRIDGE_SERVER_NAME, version: BRIDGE_SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  registerContextTools(server);
  registerPullTools(server);
  registerResources(server);
  return server;
}

// ───────────────────────── context ─────────────────────────

function registerContextTools(server: McpServer): void {
  server.registerTool(
    "get_active_context",
    {
      title: "What is the user looking at?",
      description:
        "Project the user currently has open in Vibeboard. Returns {active:false, hint} when nothing is open or the last interaction was more than 5 minutes ago. Most tools default to this when `project` is omitted, so you rarely need to call it directly.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const snap = activeContext.snapshot();
      if (!snap.active || !snap.projectId) return json(snap);
      const resolved = await resolveProject(snap.projectId);
      return json({
        ...snap,
        project: resolved.ok ? summarizeProject(resolved.project) : undefined,
      });
    }
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Vibeboard projects",
      description: "Every project on this machine, newest first, with id / title / target / asset counts.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const projects = await listProjectsFromVad().catch(() => [] as ProjectFile[]);
      const active = activeContext.snapshot();
      return json({
        activeProjectId: active.active ? active.projectId : undefined,
        count: projects.length,
        projects: projects
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(summarizeProject),
      });
    }
  );

  server.registerTool(
    "get_project",
    {
      title: "Get Vibeboard project",
      description:
        "Project metadata: brief (positioning / users / platform / visual style / features), visual target, direction card, design context summary, and final asset list with ids, roles and sizes.",
      inputSchema: { project: PROJECT_ARG },
      annotations: READ_ONLY,
    },
    async ({ project }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const p = r.project;
      return json({
        ...summarizeProject(p),
        resolvedBy: r.source,
        brief: p.brief,
        directionCardId: p.directionCardId,
        designContext: p.designContext
          ? {
              brandVoice: p.designContext.brandVoice,
              moodKeywords: p.designContext.moodKeywords,
              colorTokens: p.designContext.colorTokens,
              typography: p.designContext.typography,
              imageStyle: p.designContext.imageStyle,
            }
          : undefined,
        assets: (p.assets ?? [])
          .filter((a) => a.source !== "materialized" && a.status !== "discarded" && a.status !== "failed" && a.src)
          .map((a) => ({
            id: a.id,
            status: a.status,
            role: a.role,
            width: a.width,
            height: a.height,
            promptPreview: a.prompt.slice(0, 160),
            hasDesignSpec: Boolean(a.designSpec),
            hasLayoutIr: Boolean(p.materializations?.[a.id]),
            approval: a.approval?.status,
          })),
        references: (p.references ?? []).map((r) => ({
          id: r.id,
          label: r.label,
          width: r.width,
          height: r.height,
          source: r.source,
        })),
      });
    }
  );
}

// ───────────────────────── pull ─────────────────────────

function registerPullTools(server: McpServer): void {
  server.registerTool(
    "get_handoff",
    {
      title: "Pull design handoff bundle",
      description:
        "PREFER THIS over multiple read_handoff_file calls. Builds the current handoff package in memory and returns the primary docs (README, DESIGN, SPEC, LAYOUT, MATERIAL_MAP, IMPLEMENTATION, ASSET_MAP, tokens.json) inline plus an index of every other file. include='all' inlines every text file; include='index' returns only the file list.",
      inputSchema: {
        project: PROJECT_ARG,
        include: z.enum(["auto", "all", "index"]).optional().describe("auto (default) | all | index"),
        maxBytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Soft cap on inlined text bytes (default ${DEFAULT_MAX_BYTES}). Excess files are listed but not inlined and truncated:true is set.`),
      },
      annotations: READ_ONLY,
    },
    async ({ project, include, maxBytes }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const built = await getBuiltHandoff(r.project);
      const mode = include ?? "auto";
      const cap = Math.min(maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES);

      const inline: Array<{ path: string; mime: string; content: string }> = [];
      let used = 0;
      let truncated = false;

      const candidates =
        mode === "index"
          ? []
          : mode === "all"
            ? built.index.filter((f) => f.isText).map((f) => f.path)
            : HANDOFF_PRIMARY_DOCS.filter((p) => built.files.has(p));

      for (const path of candidates) {
        const content = built.files.get(path);
        if (typeof content !== "string") continue;
        const bytes = Buffer.byteLength(content, "utf8");
        if (used + bytes > cap) {
          truncated = true;
          continue;
        }
        used += bytes;
        inline.push({ path, mime: mimeOf(built, path), content });
      }

      const inlined = new Set(inline.map((f) => f.path));
      return json({
        project: summarizeProject(r.project),
        packKind: built.packKind,
        builtAt: new Date(built.builtAt).toISOString(),
        inlinedBytes: used,
        truncated,
        files: inline,
        otherFiles: built.index
          .filter((f) => !inlined.has(f.path))
          .map((f) => ({ path: f.path, bytes: f.bytes, mime: f.mime })),
        hints: [
          "Image files (assets/final/*, assets/materials/*) are not inlined — call get_asset_image with the asset id from ASSET_MAP.md / get_project.",
          "design/layouts/*.json can be read via read_handoff_file or get_layout_ir(assetId).",
        ],
      });
    }
  );

  server.registerTool(
    "read_handoff_file",
    {
      title: "Read one handoff file",
      description:
        "Read a single text file from the handoff bundle by path (as listed by get_handoff / list_handoff_files). Returns up to `limit` lines from `offset` (defaults 0 / 2000) and totalLines so you can page. Binary files are rejected — use get_asset_image.",
      inputSchema: {
        project: PROJECT_ARG,
        path: z.string().min(1).describe("Bundle-relative path with forward slashes, e.g. 'SPEC.md' or 'design/layouts/asset-01.json'."),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(5000).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ project, path, offset, limit }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const built = await getBuiltHandoff(r.project);
      const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
      const content = built.files.get(normalized);
      if (content === undefined) {
        const similar = built.index
          .filter((f) => f.path.toLowerCase().includes(normalized.toLowerCase().split("/").pop() ?? ""))
          .slice(0, 8)
          .map((f) => f.path);
        return fail(`File not found in handoff bundle: ${normalized}`, undefined, { similar });
      }
      if (typeof content !== "string") {
        return fail(`${normalized} is binary (${mimeOf(built, normalized)}). Use get_asset_image for images.`);
      }
      const lines = content.split("\n");
      const start = offset ?? 0;
      const take = limit ?? 2000;
      const slice = lines.slice(start, start + take);
      return {
        content: [
          {
            type: "text",
            text:
              lines.length > start + take || start > 0
                ? `[vibeboard:file-window path=${normalized} offset=${start} limit=${take} totalLines=${lines.length}]\n${slice.join("\n")}`
                : slice.join("\n"),
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_handoff_files",
    {
      title: "List handoff files",
      description:
        "File index of the current handoff bundle: path, bytes, mime. Pass since=<unix-ms> to learn whether the bundle changed after that time (cheap polling).",
      inputSchema: {
        project: PROJECT_ARG,
        since: z.number().int().optional().describe("Unix ms. When the project has not changed since this time, returns changed:false and no files."),
      },
      annotations: READ_ONLY,
    },
    async ({ project, since }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const updatedAtMs = Date.parse(r.project.updatedAt) || 0;
      if (since !== undefined && updatedAtMs <= since) {
        return json({ changed: false, updatedAt: r.project.updatedAt });
      }
      const built = await getBuiltHandoff(r.project);
      return json({
        changed: true,
        updatedAt: r.project.updatedAt,
        packKind: built.packKind,
        count: built.index.length,
        files: built.index,
      });
    }
  );

  server.registerTool(
    "get_asset_image",
    {
      title: "View a final asset image",
      description:
        "Returns the image of a final asset (mockup / material / reference) as an image content block you can look at, plus its prompt, role, size and whether a Layout IR exists. Images are downscaled to maxEdge (default 1536px) to keep context small.",
      inputSchema: {
        project: PROJECT_ARG,
        assetId: z.string().min(1).describe("Asset id from get_project / ASSET_MAP.md. Reference images use their reference id."),
        maxEdge: z.number().int().min(256).max(4096).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ project, assetId, maxEdge }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const p = r.project;
      const asset = (p.assets ?? []).find((a) => a.id === assetId);
      const reference = asset ? undefined : (p.references ?? []).find((x) => x.id === assetId);
      const src = asset?.src ?? reference?.src;
      if (!src) return fail(`No asset or reference with id ${assetId} in project ${p.id}.`);

      const dataUrl = await resolveAssetImageDataUrl(src, p.id);
      if (!dataUrl) return fail(`Asset ${assetId} image could not be loaded from disk or URL.`);
      const compressed = await compressImageDataUrlForVision(dataUrl, { maxEdge: maxEdge ?? 1536 });
      const parsed = compressed.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!parsed) return fail(`Asset ${assetId} image is not a base64 data URL after processing.`);

      const meta = asset
        ? {
            kind: "asset",
            id: asset.id,
            role: asset.role,
            status: asset.status,
            width: asset.width,
            height: asset.height,
            model: asset.model,
            prompt: asset.prompt,
            designSpecSummary: asset.designSpec?.summary,
            hasLayoutIr: Boolean(p.materializations?.[asset.id]),
            parentAssetId: asset.parentAssetId,
            materialSlotId: asset.materialSlotId,
          }
        : {
            kind: "reference",
            id: reference!.id,
            label: reference!.label,
            width: reference!.width,
            height: reference!.height,
            notes: reference!.notes,
          };

      return {
        content: [
          { type: "image", data: parsed[2], mimeType: parsed[1] },
          {
            type: "text",
            text: JSON.stringify(
              { ...meta, deliveredWidth: compressed.width || undefined, deliveredHeight: compressed.height || undefined },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_layout_ir",
    {
      title: "Get Layout IR for a mockup",
      description:
        "Authoritative geometry for an approved mockup: regions with bbox, role, copy text, and rebuildInCode (true → build with real components; false → place the referenced material image). Includes style lock (palette, radius, type scale).",
      inputSchema: {
        project: PROJECT_ARG,
        assetId: z.string().min(1).describe("Mockup asset id that has been materialized."),
      },
      annotations: READ_ONLY,
    },
    async ({ project, assetId }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const record = r.project.materializations?.[assetId];
      if (!record) {
        const available = Object.keys(r.project.materializations ?? {});
        return fail(
          `No Layout IR for asset ${assetId}. The user has not run "materialize" on it in Vibeboard yet.`,
          undefined,
          { materializedAssetIds: available }
        );
      }
      const materialAssets = (r.project.assets ?? []).filter(
        (a) => a.parentAssetId === assetId && a.source === "materialized" && a.src
      );
      return json({
        ...record,
        materials: materialAssets.map((a) => ({
          id: a.id,
          slotId: a.materialSlotId,
          role: a.role,
          width: a.width,
          height: a.height,
          status: a.status,
        })),
      });
    }
  );

  server.registerTool(
    "get_kickoff_prompt",
    {
      title: "Get kickoff prompt",
      description:
        "The implementation kickoff prompt Vibeboard would hand to a coding agent: scope, read order, rules and acceptance checks. Use it as your task brief.",
      inputSchema: {
        project: PROJECT_ARG,
        target: z.enum(["cursor", "claude-code", "codex", "markdown"]).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ project, target }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      return {
        content: [{ type: "text", text: buildKickoffClipboardText(r.project, target ?? "cursor") }],
      };
    }
  );
}

// ───────────────────────── resources ─────────────────────────

function registerResources(server: McpServer): void {
  server.registerResource(
    "handoff-file",
    new ResourceTemplate("vad://projects/{projectId}/handoff/{+path}", {
      list: async () => {
        const snap = activeContext.snapshot();
        if (!snap.active || !snap.projectId) return { resources: [] };
        const r = await resolveProject(snap.projectId);
        if (!r.ok) return { resources: [] };
        const built = await getBuiltHandoff(r.project);
        return {
          resources: built.index
            .filter((f) => f.isText)
            .map((f) => ({
              uri: `vad://projects/${r.project.id}/handoff/${f.path}`,
              name: f.path,
              mimeType: f.mime,
              description: `${r.project.title} — ${f.path}`,
            })),
        };
      },
    }),
    {
      title: "Vibeboard handoff file",
      description: "Text files of a project's handoff bundle (docs, tokens, layouts, specs).",
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? "");
      const path = decodeURIComponent(String(variables.path ?? ""));
      const r = await resolveProject(projectId);
      if (!r.ok) throw new Error(r.error);
      const built = await getBuiltHandoff(r.project);
      const content = built.files.get(path);
      if (content === undefined) throw new Error(`Not found: ${path}`);
      if (typeof content !== "string") {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: mimeOf(built, path),
              blob: Buffer.from(content).toString("base64"),
            },
          ],
        };
      }
      return { contents: [{ uri: uri.href, mimeType: mimeOf(built, path), text: content }] };
    }
  );
}

// ───────────────────────── helpers ─────────────────────────

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(
  message: string,
  candidates?: Array<{ id: string; title: string }>,
  extra?: Record<string, unknown>
): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, candidates, ...extra }, null, 2),
      },
    ],
  };
}

function mimeOf(built: BuiltHandoff, path: string): string {
  return built.index.find((f) => f.path === path)?.mime ?? "text/plain";
}
