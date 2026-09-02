/**
 * Vibeboard Daemon 路由
 * --------------------------------------------------------------
 * 将 HTTP 请求映射到 .vad 持久化层（与 Next API 行为一致）。
 *
 * @author：wangjunhua
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProjectFile } from "@/lib/project/schema";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import { handleWatchSse } from "./watch-sse";
import {
  applyFileEditToProject,
  loadMergedProjectFromVad,
} from "@/lib/vad/apply-file-edit";
import { syncHandoffBundle } from "@/lib/vad/handoff-sync";
import { VAD_ROOT } from "@/lib/vad/paths";
import {
  listProjectFileTree,
  listProjectsFromVad,
  loadChatHistoryFromVad,
  readProjectFile,
  saveChatHistoryToVad,
  saveProjectToVad,
  writeProjectFile,
} from "@/lib/vad/persist";

const DAEMON_VERSION = "0.1.0";

function checkAuth(req: IncomingMessage): boolean {
  const expected = process.env.VAD_DAEMON_TOKEN?.trim();
  if (!expected) return true;
  const got = req.headers["x-vad-daemon-token"];
  return typeof got === "string" && got === expected;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function parsePath(url: string): { pathname: string; search: string } {
  const q = url.indexOf("?");
  const pathname = (q >= 0 ? url.slice(0, q) : url).replace(/\/+$/, "") || "/";
  const search = q >= 0 ? url.slice(q) : "";
  return { pathname, search };
}

/** 匹配 /v1/projects/:id/files/... */
function matchProjectFiles(
  pathname: string
): { projectId: string; relPath: string } | null {
  const prefix = "/v1/projects/";
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const filesIdx = rest.indexOf("/files/");
  if (filesIdx < 0) return null;
  const projectId = decodeURIComponent(rest.slice(0, filesIdx));
  const relPath = decodeURIComponent(rest.slice(filesIdx + "/files/".length));
  if (!projectId || !relPath) return null;
  return { projectId, relPath };
}

export async function handleDaemonRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  const { pathname } = parsePath(url);

  if (pathname === "/health" && method === "GET") {
    sendJson(res, 200, {
      ok: true,
      version: DAEMON_VERSION,
      vadRoot: VAD_ROOT,
      pid: process.pid,
    });
    return;
  }

  if (!checkAuth(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  try {
    if (pathname === "/v1/projects" && method === "GET") {
      const projects = await listProjectsFromVad();
      sendJson(res, 200, { projects });
      return;
    }

    if (pathname === "/v1/projects" && method === "POST") {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { project?: ProjectFile };
      if (!body.project?.id) {
        sendJson(res, 400, { error: "invalid_project" });
        return;
      }
      const updated = await saveProjectToVad(body.project);
      try {
        await syncHandoffBundle(updated);
      } catch (e) {
        console.warn("[vad-daemon] handoff sync failed:", e);
      }
      sendJson(res, 200, { success: true, project: updated });
      return;
    }

    const projectOnly = pathname.match(/^\/v1\/projects\/([^/]+)$/);
    if (projectOnly && method === "GET") {
      const projectId = decodeURIComponent(projectOnly[1]);
      const project = await loadMergedProjectFromVad(projectId);
      if (!project) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      sendJson(res, 200, { project });
      return;
    }

    const watchMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/watch$/);
    if (watchMatch && method === "GET") {
      handleWatchSse(req, res, decodeURIComponent(watchMatch[1]));
      return;
    }

    const chatMatch = pathname.match(/^\/v1\/projects\/([^/]+)\/chat$/);
    if (chatMatch) {
      const projectId = decodeURIComponent(chatMatch[1]);
      if (method === "GET") {
        const messages = await loadChatHistoryFromVad(projectId);
        sendJson(res, 200, { messages });
        return;
      }
      if (method === "POST") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { messages?: ChatMessage[] };
        if (!Array.isArray(body.messages)) {
          sendJson(res, 400, { error: "invalid_messages" });
          return;
        }
        await saveChatHistoryToVad(projectId, body.messages);
        sendJson(res, 200, {
          success: true,
          count: body.messages.length,
        });
        return;
      }
    }

    const filesList = pathname.match(/^\/v1\/projects\/([^/]+)\/files$/);
    if (filesList && method === "GET") {
      const projectId = decodeURIComponent(filesList[1]);
      const tree = await listProjectFileTree(projectId);
      sendJson(res, 200, { tree });
      return;
    }

    const filePath = matchProjectFiles(pathname);
    if (filePath) {
      const { projectId, relPath } = filePath;
      if (method === "GET") {
        try {
          const content = await readProjectFile(projectId, relPath);
          sendJson(res, 200, { path: relPath, content });
        } catch (e) {
          const msg = (e as Error).message;
          sendJson(res, msg === "invalid_path" ? 403 : 404, { error: msg });
        }
        return;
      }
      if (method === "PUT") {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { content?: string };
        if (typeof body.content !== "string") {
          sendJson(res, 400, { error: "missing_content" });
          return;
        }
        try {
          await writeProjectFile(projectId, relPath, body.content);
          const sync = await applyFileEditToProject(
            projectId,
            relPath,
            body.content
          );
          sendJson(res, 200, {
            success: true,
            path: relPath,
            project: sync.synced ? sync.project : undefined,
            syncWarning: sync.synced
              ? undefined
              : sync.reason === "parse_error"
                ? sync.message
                : undefined,
          });
        } catch (e) {
          const msg = (e as Error).message;
          const status =
            msg === "path_not_editable" || msg === "invalid_path" ? 403 : 500;
          sendJson(res, status, { error: msg });
        }
        return;
      }
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (e) {
    console.error("[vad-daemon] request error:", e);
    sendJson(res, 500, { error: (e as Error).message });
  }
}
