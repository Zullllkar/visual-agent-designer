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

import { buildDirectPendingAssets } from "@/lib/agents/direct-image-generation";
import { registerAllJobHandlers } from "@/lib/agents/job/job-handlers";
import { jobScheduler } from "@/lib/agents/job/job-scheduler";
import { cropSlotFromMockup } from "@/lib/handoff/crop-slot";
import { buildKickoffClipboardText } from "@/lib/handoff/kickoff-prompt";
import { MATERIAL_SLOT_COST_USD } from "@/lib/handoff/materialize-cost";
import { diffDesignSnapshots, takeDesignSnapshot } from "@/lib/handoff/design-snapshot";
import { resolveAssetImageDataUrl } from "@/lib/handoff/resolve-asset-src";
import { buildScreenTask, getScreen, latestReportByAsset, listScreens } from "@/lib/handoff/screens";
import { pickPrimaryMockup } from "@/lib/handoff/select-assets";
import { buildSharedComponentIndex } from "@/lib/handoff/shared-components";
import { isCodingHandoffPack, resolveHandoffPackKind } from "@/lib/handoff/pack-kind";
import { compressImageDataUrlForVision } from "@/lib/handoff/vision-image";
import type { ProjectFile } from "@/lib/project/schema";
import { resolveProviders } from "@/lib/providers/registry";
import { listProjectsFromVad } from "@/lib/vad/storage";

import { activeContext } from "./active-context";
import { captureAgent, captureViaDesktop } from "./capture-agent";
import { BRIDGE_SERVER_NAME } from "./config";
import { describeProposal, ProposalChangeSchema } from "./design-proposal";
import {
  HANDOFF_PRIMARY_DOCS,
  getBuiltHandoff,
  type BuiltHandoff,
} from "./handoff-cache";
import { listImplementationReports, reviewImplementation } from "./implementation-review";
import {
  bridgeRequests,
  isAutoApproveAssets,
  type BridgeRequest,
} from "./pending-requests";
import { getCachedProviderConfig, providerCacheStatus } from "./provider-cache";
import { readScreenshotInput } from "./screenshot-input";
import { resolveProject, summarizeProject } from "./resolve-project";
import { findBaselineSnapshot, recordDesignSnapshot } from "./snapshot-store";

export const BRIDGE_SERVER_VERSION = "0.1.0";

const SERVER_INSTRUCTIONS = [
  "Vibeboard is a local design studio. First call get_active_context or list_projects and read packKind.",
  "If packKind is code-kickoff: final visuals, layout IR, tokens and specs are the source of truth for the code you write. Work screen by screen — list_screens → get_screen_task → implement → report_implementation.",
  "If packKind is art-bible, media-pack or none: this is NOT a UI to implement. Read ART_BIBLE.md / COPY.md / STYLE_NOTES.md via get_handoff, look at images with get_asset_image. Do not call get_layout_ir, propose_design_change or report_implementation. Unstarred assets are exploration, not finals.",
  "Start with get_active_context (or pass `project` explicitly), then call get_handoff once. Prefer it over many read_handoff_file calls.",
  "For code-kickoff: use get_layout_ir for regions; get_asset_crop(slotId) to zoom. Never invent a different visual system.",
  "For code-kickoff after implementing a screen, call report_implementation with the dev-server url (desktop captures it) or a screenshot.",
  "Missing an image? request_asset. Unsure? ask_designer. Layout cannot be implemented as specified? propose_design_change (code-kickoff only).",
  "If the designer changes a code-kickoff after you built a screen, call get_design_changes and patch incrementally.",
].join("\n");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/** 工具内等待用户处理的上限，留在 Codex 默认 60s 工具超时之内。 */
const USER_WAIT_MS = 40_000;

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
  registerWriteBackTools(server);
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
      const summary = resolved.ok ? summarizeProject(resolved.project) : undefined;
      const packKind = resolved.ok ? resolveHandoffPackKind(resolved.project) : undefined;
      return json({
        ...snap,
        packKind,
        codingHandoff: packKind ? isCodingHandoffPack(packKind) : undefined,
        project: summary,
        workflow: packKind && !isCodingHandoffPack(packKind)
          ? "Look at starred finals with get_handoff + get_asset_image. Do not implement UI screens."
          : "list_screens → get_screen_task → implement → report_implementation.",
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
    "list_screens",
    {
      title: "List screens to implement",
      description:
        "Every final mockup as a screen, in suggested implementation order (approved → materialized → starred → rest). Each entry has readiness (ready | partial | draft, with what is missing), Layout IR / material counts, copy-plan counts, the files to read, and the latest report_implementation verdict. Use this to pick the next screen and to see overall progress.",
      inputSchema: { project: PROJECT_ARG },
      annotations: READ_ONLY,
    },
    async ({ project }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const reports = await listImplementationReports(r.project.id, 200).catch(() => []);
      const screens = listScreens(r.project, reports);
      const passed = screens.filter((s) => s.implementation?.verdict === "pass").length;
      const shared = buildSharedComponentIndex(r.project);
      const packKind = resolveHandoffPackKind(r.project);
      const coding = isCodingHandoffPack(packKind);
      const nextSuggested = coding
        ? (screens.find((s) => !s.implementation || s.implementation.verdict !== "pass")?.assetId ?? null)
        : (screens.find((s) => s.status.starred)?.assetId ?? null);
      return json({
        project: summarizeProject(r.project),
        packKind,
        count: screens.length,
        progress: coding
          ? {
              passed,
              reviewed: screens.filter((s) => s.implementation && s.implementation.verdict !== "unreviewed").length,
              ready: screens.filter((s) => s.readiness.level === "ready").length,
            }
          : {
              starred: screens.filter((s) => s.status.starred).length,
              exploring: screens.filter((s) => !s.status.starred).length,
              ready: screens.filter((s) => s.status.starred).length,
            },
        nextSuggested,
        sharedComponents: coding
          ? shared.components.map((c) => ({
              id: c.id,
              name: c.name,
              kind: c.kind,
              screenCount: c.screenCount,
              screens: [...new Set(c.instances.map((i) => i.assetId))],
            }))
          : [],
        screens,
        hint: coding
          ? "Call get_screen_task(assetId) for the next screen. Build sharedComponents once (they appear on several screens) before screen-specific work. Screens with readiness=draft usually need the designer to materialize them first — ask via ask_designer if that blocks you."
          : nextSuggested
            ? `This is a ${packKind} (not a UI-to-code pack). Starred assets are the finals. Call get_screen_task(assetId) for usage, then get_asset_image. Do not implement React screens or call report_implementation.`
            : "This is not a UI-to-code pack, and nothing is starred yet. Ask the designer to star the finals in Vibeboard before treating any image as production art. You can still get_asset_image to look.",
      });
    }
  );

  server.registerTool(
    "get_screen_task",
    {
      title: "Get a task brief for one screen",
      description:
        "Focused implementation brief for a single mockup: scope, readiness warnings, exact files to read, the region table from Layout IR (bbox, build mode, copy, swatch), the authoritative copy plan, acceptance steps, and any open deviations from the last review. Implement exactly this screen, then report_implementation with the same assetId.",
      inputSchema: {
        project: PROJECT_ARG,
        assetId: z.string().min(1).describe("Screen (mockup asset) id from list_screens."),
      },
      annotations: READ_ONLY,
    },
    async ({ project, assetId }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const reports = await listImplementationReports(r.project.id, 200).catch(() => []);
      const screens = listScreens(r.project, reports);
      const screen = screens.find((s) => s.assetId === assetId) ?? getScreen(r.project, assetId, reports);
      if (!screen) {
        return fail(`No screen (final mockup) with id ${assetId}.`, undefined, {
          screenIds: screens.map((s) => s.assetId),
        });
      }
      const latest = latestReportByAsset(reports).get(assetId);
      void recordDesignSnapshot(r.project).catch(() => undefined);
      const shared = buildSharedComponentIndex(r.project);
      return {
        content: [
          { type: "text", text: buildScreenTask(r.project, screen, latest, screens.length, shared) },
        ],
      };
    }
  );

  server.registerTool(
    "get_design_changes",
    {
      title: "What changed in the design since I last looked?",
      description:
        "Semantic diff of the design between a baseline and now: screens added/removed, mockups regenerated, Layout IR regions added/removed/moved/resized, copy and copy-plan edits, materials regenerated, swatch/palette changes — each with an impact level (rebuild | relayout | restyle | copy-only). Use it after the designer changes things so you patch incrementally instead of re-implementing. Baseline defaults to your last report_implementation for this project; pass `since` (ISO or unix ms) to override.",
      inputSchema: {
        project: PROJECT_ARG,
        since: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Baseline time as ISO string or unix ms. Default: time of the latest report_implementation, else the oldest snapshot."),
        assetId: z.string().optional().describe("Only report changes for this screen."),
      },
      annotations: READ_ONLY,
    },
    async ({ project, since, assetId }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const p = r.project;

      let sinceMs: number | undefined;
      if (typeof since === "number") sinceMs = since;
      else if (typeof since === "string" && since.trim()) {
        const parsed = Date.parse(since);
        if (Number.isNaN(parsed)) return fail(`since is not a valid time: ${since}`);
        sinceMs = parsed;
      }
      let baselineSource: "since" | "last-report" | "oldest-snapshot" = "since";
      if (sinceMs === undefined) {
        const reports = await listImplementationReports(p.id, 200).catch(() => []);
        const relevant = assetId ? reports.filter((x) => x.assetId === assetId) : reports;
        const last = relevant[0];
        if (last) {
          sinceMs = Date.parse(last.createdAt);
          baselineSource = "last-report";
        } else {
          sinceMs = 0;
          baselineSource = "oldest-snapshot";
        }
      }

      const baseline = await findBaselineSnapshot(p.id, sinceMs);
      const current = takeDesignSnapshot(p);
      void recordDesignSnapshot(p).catch(() => undefined);
      if (!baseline) {
        return json({
          baseline: null,
          hint: "No design snapshots exist yet for this project. This call recorded the first one — call get_design_changes again after the designer makes changes.",
          current: { takenAt: current.takenAt, screens: Object.keys(current.screens).length },
        });
      }

      let changes = diffDesignSnapshots(baseline.snapshot, current);
      if (assetId) {
        changes = {
          ...changes,
          addedScreens: changes.addedScreens.filter((s) => s.assetId === assetId),
          removedScreens: changes.removedScreens.filter((s) => s.assetId === assetId),
          changedScreens: changes.changedScreens.filter((s) => s.assetId === assetId),
          unchangedScreens: changes.unchangedScreens.filter((id) => id === assetId),
          summary: changes.summary.filter((line) => line.includes(assetId) || /^No design/.test(line)),
        };
        if (changes.summary.length === 0) changes.summary = [`No changes to screen ${assetId} since the baseline.`];
      }
      return json({
        baseline: {
          takenAt: baseline.snapshot.takenAt,
          source: baselineSource,
          exact: baseline.exact,
          note: baseline.exact
            ? undefined
            : "No snapshot existed at or before `since`; compared against the oldest available snapshot instead.",
        },
        ...changes,
        hint:
          changes.changedScreens.length === 0 && changes.addedScreens.length === 0 && changes.removedScreens.length === 0
            ? "Nothing to do."
            : "Handle screens by impact: rebuild → re-run get_screen_task and redo the screen; relayout → adjust the listed regions; restyle → update colors / re-copy materials; copy-only → change text. Then report_implementation again.",
      });
    }
  );

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
        hints: isCodingHandoffPack(built.packKind)
          ? [
              "Image files (assets/final/*, assets/materials/*) are not inlined — call get_asset_image with the asset id from ASSET_MAP.md / get_project.",
              "design/layouts/*.json can be read via read_handoff_file or get_layout_ir(assetId).",
            ]
          : [
              `This is a ${built.packKind} pack, not a UI-to-code handoff. Do not implement React/app screens.`,
              "Read ART_BIBLE.md / ASSET_USAGE.md (or COPY.md / STYLE_NOTES.md). Images: get_asset_image with ids from get_project / list_screens.",
              "Starred assets are finals. Unstarred images are exploration.",
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
    "get_asset_crop",
    {
      title: "Zoom into one region of a mockup",
      description:
        "Crop a region of a final asset at full source resolution and return it as an image. Pass slotId (a Layout IR node id from get_layout_ir) to crop exactly that region, or an explicit bbox (normalized 0-1, or pixels). Use this instead of squinting at the downscaled get_asset_image when you need to read small copy, icon details, border radii or spacing inside one area.",
      inputSchema: {
        project: PROJECT_ARG,
        assetId: z.string().min(1).describe("Mockup asset id (from get_project / ASSET_MAP.md)."),
        slotId: z
          .string()
          .optional()
          .describe("Layout IR node id. Requires the mockup to be materialized. Takes precedence over bbox."),
        bbox: z
          .object({
            x: z.number().min(0),
            y: z.number().min(0),
            w: z.number().positive(),
            h: z.number().positive(),
          })
          .optional()
          .describe("Region to crop. Values ≤1 are treated as normalized fractions of the image; larger values as pixels."),
        padding: z
          .number()
          .min(0)
          .max(0.5)
          .optional()
          .describe("Extra context around the region as a fraction of the region size (default 0.08)."),
        maxEdge: z
          .number()
          .int()
          .min(256)
          .max(4096)
          .optional()
          .describe("Longest output edge in px (default 1536). The crop is never upscaled beyond source pixels."),
      },
      annotations: READ_ONLY,
    },
    async ({ project, assetId, slotId, bbox, padding, maxEdge }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const p = r.project;
      const asset = (p.assets ?? []).find((a) => a.id === assetId);
      if (!asset?.src) return fail(`No asset with id ${assetId} in project ${p.id}.`);

      const layout = p.materializations?.[assetId]?.layout;
      const slot = slotId ? layout?.nodes.find((n) => n.id === slotId) : undefined;
      if (slotId && !slot) {
        return fail(
          layout
            ? `No Layout IR node "${slotId}" on asset ${assetId}.`
            : `Asset ${assetId} has no Layout IR yet, so slotId cannot be resolved. Pass a bbox instead, or ask the user to materialize it in Vibeboard.`,
          undefined,
          { availableSlotIds: layout?.nodes.map((n) => n.id) ?? [] }
        );
      }

      const region = slot?.bbox ?? normalizeCropBBox(bbox, asset.width, asset.height);
      if (!region) return fail("Provide either slotId or bbox.");
      const pad = padding ?? 0.08;
      const padded = padBBox(region, pad);

      const crop = await cropSlotFromMockup({
        src: asset.src,
        width: asset.width,
        height: asset.height,
        bbox: padded,
        maxEdge: Math.min(maxEdge ?? 1536, Math.round(Math.max(padded.w * asset.width, padded.h * asset.height))),
        projectId: p.id,
      });
      if (!crop) return fail(`Could not crop asset ${assetId} (image unreadable or unsupported format).`);
      const parsed = crop.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!parsed) return fail("Crop did not produce a base64 image.");

      return {
        content: [
          { type: "image", data: parsed[2], mimeType: parsed[1] },
          {
            type: "text",
            text: JSON.stringify(
              {
                assetId,
                slotId: slot?.id,
                role: slot?.role,
                rebuildInCode: slot?.rebuildInCode,
                copy: slot && "copy" in slot ? slot.copy : undefined,
                swatch: slot?.swatch,
                bbox: region,
                paddedBbox: padded,
                sourcePixels: {
                  x: Math.round(padded.x * asset.width),
                  y: Math.round(padded.y * asset.height),
                  w: Math.round(padded.w * asset.width),
                  h: Math.round(padded.h * asset.height),
                },
                deliveredWidth: crop.width,
                deliveredHeight: crop.height,
              },
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
      const blocked = rejectNonCoding(r.project, "get_layout_ir");
      if (blocked) return blocked;
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

// ───────────────────────── write-back ─────────────────────────

function registerWriteBackTools(server: McpServer): void {
  server.registerTool(
    "request_asset",
    {
      title: "Ask Vibeboard for a new asset",
      description:
        "Commission a missing image (icon, illustration, hero, avatar, background) from Vibeboard instead of hand-drawing it in CSS/SVG. The designer approves it in the app (it costs money), then Vibeboard generates it and the file lands in the project + linked repo. Returns a requestId immediately; poll get_job once approved.",
      inputSchema: {
        project: PROJECT_ARG,
        description: z
          .string()
          .min(4)
          .describe("What the image should show, in English. Subject only — no UI chrome or text labels."),
        role: z
          .enum(["hero", "illustration", "product-shot", "background", "icon", "avatar", "decoration"])
          .optional()
          .describe("How the image is used in the design."),
        width: z.number().int().min(64).max(4096).optional().describe("Pixel width (default 1280)."),
        height: z.number().int().min(64).max(4096).optional().describe("Pixel height (default 720)."),
        count: z.number().int().min(1).max(4).optional().describe("How many variants to generate (default 1)."),
        referenceAssetId: z
          .string()
          .optional()
          .describe("Existing asset id to use as a style reference so the new image matches."),
      },
      annotations: WRITE,
    },
    async ({ project, description, role, width, height, count, referenceAssetId }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const p = r.project;

      const providerConfig = getCachedProviderConfig(p.id);
      if (!providerConfig?.image || providerConfig.image.kind === "mock") {
        return fail(
          "Vibeboard has no image provider credentials available. Ask the user to open Vibeboard and configure an image model in Settings → 模型. In the desktop app the keys are then kept in the system keychain, so this works even when the window is closed; in the browser they are only cached while a tab is open.",
          undefined,
          { providerCache: providerCacheStatus(p.id) }
        );
      }

      const requested = {
        description: description.trim(),
        role,
        width: width ?? 1280,
        height: height ?? 720,
        count: count ?? 1,
        referenceAssetId,
        estimatedUsd: Math.round((count ?? 1) * MATERIAL_SLOT_COST_USD * 1000) / 1000,
      };
      const request = bridgeRequests.create({
        kind: "asset",
        projectId: p.id,
        asset: requested,
      });

      let settled: BridgeRequest = request;
      if (isAutoApproveAssets()) {
        settled = bridgeRequests.resolve(request.id, { action: "approve" }) ?? request;
      } else {
        settled = await bridgeRequests.wait(request.id, USER_WAIT_MS);
      }

      if (settled.status === "rejected") {
        return json({
          requestId: request.id,
          status: "rejected",
          reason: settled.reason,
          hint: "The designer declined. Ask what to use instead, or call ask_designer.",
        });
      }
      if (settled.status !== "approved") {
        return json({
          requestId: request.id,
          status: "pending",
          hint: "Waiting for the designer to approve in Vibeboard. Continue with other work and call get_job later, or get_request to check status.",
          request: requested,
        });
      }

      const job = await startAssetJob(p, requested, providerConfig);
      bridgeRequests.attachJob(request.id, job.jobId);
      return json({
        requestId: request.id,
        status: "approved",
        jobId: job.jobId,
        assetIds: job.assetIds,
        hint: "Generation started. Poll get_job(jobId) until status is completed, then get_asset_image(assetId).",
      });
    }
  );

  server.registerTool(
    "get_request",
    {
      title: "Check a Vibeboard request",
      description:
        "Status of a request_asset / ask_designer / propose_design_change request: pending, approved (with jobId for assets, appliedSummary for proposals), rejected (with reason) or answered (with the designer's answer).",
      inputSchema: {
        requestId: z.string().min(1),
        waitMs: z
          .number()
          .int()
          .min(0)
          .max(40_000)
          .optional()
          .describe("Block up to this many ms waiting for the designer (default 0 = return immediately)."),
      },
      annotations: READ_ONLY,
    },
    async ({ requestId, waitMs }) => {
      const existing = bridgeRequests.get(requestId);
      if (!existing) return fail(`Unknown or expired requestId: ${requestId}`);
      const settled =
        waitMs && existing.status === "pending"
          ? await bridgeRequests.wait(requestId, waitMs)
          : existing;
      return json(publicRequest(settled));
    }
  );

  server.registerTool(
    "get_job",
    {
      title: "Check a generation job",
      description:
        "Poll a job started by request_asset. Returns status (pending|running|completed|failed|cancelled), progress 0-100 and, when completed, the generated asset ids — pass those to get_asset_image.",
      inputSchema: { jobId: z.string().min(1) },
      annotations: READ_ONLY,
    },
    async ({ jobId }) => {
      registerAllJobHandlers();
      const job = jobScheduler.getJob(jobId);
      if (!job) return fail(`Unknown jobId: ${jobId}. It may have been created by an earlier app session.`);
      const result = job.result as
        | { assets?: Array<{ id: string; src?: string; prompt?: string; status?: string }> }
        | undefined;
      return json({
        jobId: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress ?? 0,
        message: job.progressDetail?.message,
        error: job.error,
        assets: (result?.assets ?? []).map((a) => ({
          id: a.id,
          status: a.status,
          promptPreview: a.prompt?.slice(0, 120),
        })),
        hint:
          job.status === "completed"
            ? "Call get_asset_image(assetId) to see the result. Files also sync into the linked repo."
            : job.status === "failed"
              ? "Generation failed. Report the error to the user; do not hand-draw the asset."
              : "Still working. Poll again in a few seconds.",
      });
    }
  );

  server.registerTool(
    "ask_designer",
    {
      title: "Ask the designer a question",
      description:
        "Ask the human designer a blocking design question (e.g. which of two layouts, what an ambiguous region should do). Shows up in Vibeboard; blocks up to 40s then returns a questionId you can poll with get_request. Use this instead of guessing and building the wrong thing.",
      inputSchema: {
        project: PROJECT_ARG,
        question: z.string().min(4).describe("One concrete question. Be specific about the screen and element."),
        options: z
          .array(z.string().min(1))
          .max(6)
          .optional()
          .describe("Optional choices so the designer can answer with one click."),
        context: z.string().optional().describe("Short context: what you are building and why you are blocked."),
      },
      annotations: WRITE,
    },
    async ({ project, question, options, context }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const request = bridgeRequests.create({
        kind: "question",
        projectId: r.project.id,
        question: { question: question.trim(), options, context },
      });
      const settled = await bridgeRequests.wait(request.id, USER_WAIT_MS);
      if (settled.status === "answered") {
        return json({ questionId: request.id, status: "answered", answer: settled.answer });
      }
      if (settled.status === "rejected") {
        return json({
          questionId: request.id,
          status: "dismissed",
          reason: settled.reason,
          hint: "The designer dismissed the question. Use your best judgement and note the assumption in your summary.",
        });
      }
      return json({
        questionId: request.id,
        status: "pending",
        hint: "No answer yet. Work on something else and call get_request({requestId, waitMs}) later, or proceed and state your assumption.",
      });
    }
  );

  server.registerTool(
    "propose_design_change",
    {
      title: "Propose a change to the design",
      description:
        "When the design cannot (or should not) be implemented as specified — e.g. three columns will not fit on mobile, copy is too long for the button, a decorative image is better done in CSS — propose a concrete Layout IR change instead of silently deviating. The designer sees a card in Vibeboard and approves or rejects; approval applies the change to the Layout IR / spec immediately and syncs the handoff. Allowed changes: copy, bbox, convert-to-code, remove-slot, add-state, note. For new images use request_asset; for open questions use ask_designer.",
      inputSchema: {
        project: PROJECT_ARG,
        assetId: z.string().min(1).describe("Screen (mockup asset) id the change applies to."),
        change: ProposalChangeSchema.describe(
          "One of: {kind:'copy',slotId,copy} · {kind:'bbox',slotId,bbox:{x,y,w,h} normalized 0-1} · {kind:'convert-to-code',slotId} · {kind:'remove-slot',slotId} · {kind:'add-state',slotId,state:{name,notes,copy?}} · {kind:'note',slotId?,text}"
        ),
        rationale: z.string().min(8).describe("Why — one or two sentences the designer will read."),
      },
      annotations: WRITE,
    },
    async ({ project, assetId, change, rationale }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const blocked = rejectNonCoding(r.project, "propose_design_change");
      if (blocked) return blocked;
      const p = r.project;
      const asset = (p.assets ?? []).find((a) => a.id === assetId);
      if (!asset) return fail(`No asset ${assetId} in project ${p.id}.`);
      const layout = p.materializations?.[assetId]?.layout;
      if (change.kind !== "note" && !layout) {
        return fail(
          `Asset ${assetId} has no Layout IR yet, so only {kind:'note'} proposals are possible. Ask the designer to materialize it first.`
        );
      }
      if ("slotId" in change && change.slotId && layout && !layout.nodes.some((n) => n.id === change.slotId)) {
        return fail(`No node "${change.slotId}" on ${assetId}.`, undefined, {
          availableSlotIds: layout.nodes.map((n) => n.id),
        });
      }

      const input = { assetId, change, rationale: rationale.trim() };
      const request = bridgeRequests.create({
        kind: "proposal",
        projectId: p.id,
        proposal: { ...input, description: describeProposal(input) },
      });
      const settled = await bridgeRequests.wait(request.id, USER_WAIT_MS);
      if (settled.status === "approved") {
        return json({
          requestId: request.id,
          status: "approved",
          applied: settled.appliedSummary,
          hint: "The change is now part of the Layout IR / spec. Re-read get_layout_ir (or get_screen_task) and implement accordingly.",
        });
      }
      if (settled.status === "rejected") {
        return json({
          requestId: request.id,
          status: "rejected",
          reason: settled.reason,
          hint: "Implement the design as specified. If that is impossible, ask_designer with the constraint spelled out.",
        });
      }
      return json({
        requestId: request.id,
        status: "pending",
        description: describeProposal(input),
        hint: "Waiting for the designer. Continue other work and call get_request({requestId, waitMs}) later; until approved, implement the design as specified.",
      });
    }
  );

  server.registerTool(
    "report_implementation",
    {
      title: "Report an implemented screen for review",
      description:
        "Report a screen you implemented so Vibeboard can compare it against the approved mockup and Layout IR. Returns a structured deviation list (slot, kind, expected, actual, fixHint) plus a 0-10 score. Fix the high-severity items and report again. This is the acceptance loop — call it after each screen. EASIEST: just pass `url` (your running dev server) — when the Vibeboard desktop app is open it takes the full-page screenshot itself. Otherwise pass screenshotBase64 or screenshotPath.",
      inputSchema: {
        project: PROJECT_ARG,
        assetId: z
          .string()
          .optional()
          .describe("Which approved mockup this screen implements. Defaults to the project's primary mockup."),
        summary: z.string().min(4).describe("One or two sentences: what you implemented and anything you deliberately changed."),
        url: z
          .string()
          .optional()
          .describe(
            "Where the screen runs, e.g. http://localhost:5173/dashboard. If no screenshot is passed, Vibeboard (desktop app) loads this URL and captures a full-page screenshot for you."
          ),
        viewportWidth: z
          .number()
          .int()
          .min(320)
          .max(2560)
          .optional()
          .describe("Viewport width for the automatic capture. Defaults to the mockup's width (capped at 1920)."),
        screenshotBase64: z
          .string()
          .optional()
          .describe("PNG/JPEG as base64 (or a data: URL). Use when you already have a screenshot."),
        screenshotPath: z
          .string()
          .optional()
          .describe("Absolute path to a screenshot inside the linked repo or the system temp dir."),
      },
      annotations: WRITE,
    },
    async ({ project, assetId, summary, screenshotBase64, screenshotPath, url, viewportWidth }) => {
      const r = await resolveProject(project);
      if (!r.ok) return fail(r.error, r.candidates);
      const p = r.project;
      const blocked = rejectNonCoding(p, "report_implementation");
      if (blocked) return blocked;

      let shot = await readScreenshotInput(p, { screenshotBase64, screenshotPath });
      let captured: { width: number; height: number; finalUrl?: string; elapsedMs: number } | undefined;
      const wantsAutoCapture = !screenshotBase64?.trim() && !screenshotPath?.trim() && Boolean(url?.trim());
      if (wantsAutoCapture) {
        const target = url!.trim();
        if (!/^https?:\/\//i.test(target)) {
          return fail(`url must be http(s), got: ${target}`);
        }
        const mockup = assetId
          ? (p.assets ?? []).find((a) => a.id === assetId)
          : pickPrimaryMockup(p);
        const width = viewportWidth ?? Math.min(1920, Math.max(320, Math.round(mockup?.width ?? 1440)));
        const cap = await captureViaDesktop({ url: target, width, fullPage: true });
        if (!cap.ok) {
          return fail(cap.error, undefined, {
            code: cap.code,
            desktopCapture: captureAgent.status(),
            hint:
              cap.code === "no_agent"
                ? "Ask the user to open the Vibeboard desktop app, or take a screenshot yourself (e.g. browser devtools / playwright) and pass screenshotBase64."
                : "Check that the dev server is running and the URL renders, then retry. You can also pass screenshotBase64 directly.",
          });
        }
        shot = { ok: true, dataUrl: cap.dataUrl, from: "base64", bytes: Math.floor((cap.dataUrl.length * 3) / 4) };
        captured = { width: cap.width, height: cap.height, finalUrl: cap.finalUrl, elapsedMs: cap.elapsedMs };
      }
      if (!shot.ok) return fail(shot.error);

      // 回报时的设计状态 = 代码对着做的那版，作为后续 get_design_changes 的基线
      void recordDesignSnapshot(p).catch(() => undefined);
      const providerConfig = getCachedProviderConfig(p.id);
      const llm = providerConfig ? resolveProviders(providerConfig).llm : undefined;
      const report = await reviewImplementation({
        project: p,
        assetId,
        reportedSummary: summary.trim(),
        screenshotDataUrl: shot.dataUrl,
        url,
        llm,
      });

      return json({
        reportId: report.id,
        reviewedAgainst: report.assetId,
        source: report.source,
        capturedBy: captured ? "vibeboard-desktop" : shot.from,
        capture: captured,
        score: report.score,
        verdict: report.verdict,
        summary: report.summary,
        matched: report.matched,
        deviations: report.deviations,
        warnings: report.warnings,
        hint:
          report.verdict === "unreviewed"
            ? "Vibeboard recorded your report but could NOT compare it visually (see warnings). Do not treat this as feedback and do not iterate on it — tell the user to open Vibeboard and configure a vision-capable LLM, then call report_implementation again."
            : report.deviations.length === 0
              ? "No deviations found. Tell the user the screen matches the design."
              : "Fix the high-severity deviations using each fixHint, then call report_implementation again with a fresh screenshot.",
      });
    }
  );
}

async function startAssetJob(
  project: ProjectFile,
  request: {
    description: string;
    role?: string;
    width: number;
    height: number;
    count: number;
    referenceAssetId?: string;
  },
  providerConfig: NonNullable<ReturnType<typeof getCachedProviderConfig>>
): Promise<{ jobId: string; assetIds: string[] }> {
  registerAllJobHandlers();
  const referenceAsset = request.referenceAssetId
    ? (project.assets ?? []).find((a) => a.id === request.referenceAssetId)
    : undefined;

  const generationRequest = {
    prompt: request.description,
    count: request.count,
    width: request.width,
    height: request.height,
    visualStyle: project.brief?.visualStyle,
    role: request.role as "hero" | "illustration" | "product-shot" | "background" | "icon" | "avatar" | "decoration" | undefined,
    referenceImages: referenceAsset?.src ? [referenceAsset.src] : undefined,
  };
  const batchId = `bridge-${Date.now().toString(36)}`;
  const pendingAssets = buildDirectPendingAssets(generationRequest, batchId);
  const job = jobScheduler.submit({
    type: "direct_image_generation",
    projectId: project.id,
    batchId,
    payload: {
      project,
      providerConfig,
      request: generationRequest,
      pendingAssets,
      requestedVia: "bridge",
    },
  });
  return { jobId: job.id, assetIds: pendingAssets.map((a) => a.id) };
}

export function publicRequest(request: BridgeRequest) {
  return {
    requestId: request.id,
    kind: request.kind,
    status: request.status,
    createdAt: request.createdAt,
    resolvedAt: request.resolvedAt,
    jobId: request.jobId,
    answer: request.answer,
    reason: request.reason,
    appliedSummary: request.appliedSummary,
    asset: request.asset,
    question: request.question,
    proposal: request.proposal,
  };
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

function rejectNonCoding(project: ProjectFile, tool: string): CallToolResult | null {
  const packKind = resolveHandoffPackKind(project);
  if (isCodingHandoffPack(packKind)) return null;
  return fail(
    `Project "${project.title}" is a ${packKind} pack (${project.targetId ?? "non-UI"}), not a UI-to-code handoff. ${tool} does not apply. Use get_handoff + get_asset_image; starred assets are the finals.`,
    undefined,
    { packKind, targetId: project.targetId, tool }
  );
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

type NormBBox = { x: number; y: number; w: number; h: number };

/** 接受 0–1 归一化或像素值；越界裁到图内；过小返回 null */
function normalizeCropBBox(
  bbox: NormBBox | undefined,
  width: number,
  height: number
): NormBBox | null {
  if (!bbox) return null;
  const pixelLike = bbox.x > 1 || bbox.y > 1 || bbox.w > 1 || bbox.h > 1;
  const x = clamp01(pixelLike ? bbox.x / Math.max(1, width) : bbox.x);
  const y = clamp01(pixelLike ? bbox.y / Math.max(1, height) : bbox.y);
  const w = clamp01(pixelLike ? bbox.w / Math.max(1, width) : bbox.w);
  const h = clamp01(pixelLike ? bbox.h / Math.max(1, height) : bbox.h);
  if (w < 0.005 || h < 0.005) return null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function padBBox(b: NormBBox, pad: number): NormBBox {
  const dx = b.w * pad;
  const dy = b.h * pad;
  const left = clamp01(b.x - dx);
  const top = clamp01(b.y - dy);
  const right = clamp01(b.x + b.w + dx);
  const bottom = clamp01(b.y + b.h + dy);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
