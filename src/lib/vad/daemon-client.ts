/**
 * VAD Daemon HTTP 客户端（Next.js server 侧）
 * --------------------------------------------------------------
 * 与 daemon/server 的 /v1/* 路由对应；失败时抛出错误由 storage 层回退。
 *
 * @author：wangjunhua
 */

import type { ProjectFile } from "@/lib/project/schema";
import type { ChatMessage } from "@/lib/agents/chat-schema";
import type { VadFileNode } from "@/lib/vad/types";
import type { ApplyFileEditResult } from "@/lib/vad/apply-file-edit";
import { getDaemonAuthToken, getDaemonBaseUrl } from "./daemon-config";

function baseUrl(): string {
  const url = getDaemonBaseUrl();
  if (!url) throw new Error("daemon_not_configured");
  return url;
}

function authHeaders(): Record<string, string> {
  const token = getDaemonAuthToken();
  return token ? { "x-vad-daemon-token": token } : {};
}

async function daemonFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return res;
}

export async function daemonHealth(): Promise<{
  ok: boolean;
  version?: string;
  vadRoot?: string;
}> {
  const res = await daemonFetch("/health");
  if (!res.ok) return { ok: false };
  return (await res.json()) as { ok: boolean; version?: string; vadRoot?: string };
}

export async function daemonListProjects(): Promise<ProjectFile[]> {
  const res = await daemonFetch("/v1/projects");
  if (!res.ok) throw new Error(`daemon_list_projects: ${res.status}`);
  const data = (await res.json()) as { projects?: ProjectFile[] };
  return data.projects ?? [];
}

export async function daemonLoadProject(
  projectId: string
): Promise<ProjectFile | null> {
  const res = await daemonFetch(`/v1/projects/${encodeURIComponent(projectId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`daemon_load_project: ${res.status}`);
  const data = (await res.json()) as { project?: ProjectFile };
  return data.project ?? null;
}

export async function daemonSaveProject(
  project: ProjectFile
): Promise<ProjectFile> {
  const res = await daemonFetch("/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `daemon_save_project: ${res.status}`);
  }
  const data = (await res.json()) as { project?: ProjectFile };
  if (!data.project) throw new Error("daemon_save_project: empty body");
  return data.project;
}

export async function daemonLoadChat(
  projectId: string
): Promise<ChatMessage[]> {
  const res = await daemonFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/chat`
  );
  if (!res.ok) throw new Error(`daemon_load_chat: ${res.status}`);
  const data = (await res.json()) as { messages?: ChatMessage[] };
  return data.messages ?? [];
}

export async function daemonSaveChat(
  projectId: string,
  messages: ChatMessage[]
): Promise<void> {
  const res = await daemonFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/chat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    }
  );
  if (!res.ok) throw new Error(`daemon_save_chat: ${res.status}`);
}

export async function daemonListFileTree(
  projectId: string
): Promise<VadFileNode[]> {
  const res = await daemonFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/files`
  );
  if (!res.ok) throw new Error(`daemon_list_files: ${res.status}`);
  const data = (await res.json()) as { tree?: VadFileNode[] };
  return data.tree ?? [];
}

export async function daemonReadFile(
  projectId: string,
  relPath: string
): Promise<string> {
  const segments = relPath.split("/").map(encodeURIComponent).join("/");
  const res = await daemonFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/files/${segments}`
  );
  if (!res.ok) throw new Error(`daemon_read_file: ${res.status}`);
  const data = (await res.json()) as { content?: string };
  return data.content ?? "";
}

export async function daemonWriteFile(
  projectId: string,
  relPath: string,
  content: string
): Promise<{
  project?: ProjectFile;
  syncWarning?: string;
}> {
  const segments = relPath.split("/").map(encodeURIComponent).join("/");
  const res = await daemonFetch(
    `/v1/projects/${encodeURIComponent(projectId)}/files/${segments}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `daemon_write_file: ${res.status}`);
  }
  return (await res.json()) as { project?: ProjectFile; syncWarning?: string };
}
