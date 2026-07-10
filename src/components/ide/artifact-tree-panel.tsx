"use client";

/**
 * Artifact 文件树面板
 * --------------------------------------------------------------
 * 浏览 .vad/projects/<id>/ 下的真实文件，支持编辑 md/json 并保存。
 *
 * @author：wangjunhua
 */

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  Loader2,
  Save,
} from "lucide-react";
import type { VadFileNode } from "@/lib/vad/types";
import type { ProjectFile } from "@/lib/project/schema";
import { useProjectStore } from "@/store/project-store";

interface ArtifactTreePanelProps {
  projectId: string;
  /** 外部 watch 触发时递增，用于刷新文件树 */
  refreshKey?: number;
}

const EDITABLE_EXT = /\.(md|json|txt|cursorrules)$/i;

function isEditableFile(path: string): boolean {
  return (
    EDITABLE_EXT.test(path) ||
    path === "project.json" ||
    path === "canvas.json" ||
    path.startsWith("prompts/") ||
    path.startsWith("handoff/") ||
    path.startsWith("design/")
  );
}

export function ArtifactTreePanel({
  projectId,
  refreshKey = 0,
}: ArtifactTreePanelProps) {
  const upsert = useProjectStore((s) => s.upsert);
  const [tree, setTree] = useState<VadFileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      const data = (await res.json()) as { tree?: VadFileNode[] };
      setTree(data.tree ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree, refreshKey]);

  async function openFile(path: string) {
    if (!isEditableFile(path)) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/files/${path.split("/").map(encodeURIComponent).join("/")}`
      );
      const data = (await res.json()) as { content?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSelectedPath(path);
      setContent(data.content ?? "");
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveFile() {
    if (!selectedPath) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/files/${selectedPath.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        }
      );
      const data = (await res.json()) as {
        error?: string;
        project?: ProjectFile;
        syncWarning?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.project) {
        upsert(data.project);
      }
      if (data.syncWarning) {
        setError(`已保存文件，但项目合并失败：${data.syncWarning}`);
      }
      setDirty(false);
      await refreshTree();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden border-r border-zinc-900 bg-zinc-950 text-[#F4F7FA]">
      <div className="border-b border-zinc-900 px-4 py-3">
        <p className="text-xs font-bold text-zinc-400">Artifact 文件树</p>
        <p className="mt-1 text-[10px] text-zinc-600">
          .vad/projects/{projectId}/
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
          {loading ? (
            <div className="flex items-center gap-2 p-3 text-zinc-500">
              <Loader2 className="size-3.5 animate-spin" />
              加载文件树…
            </div>
          ) : (
            tree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                onSelect={openFile}
              />
            ))
          )}
        </div>

        {selectedPath ? (
          <div className="flex min-h-[200px] flex-1 flex-col border-t border-zinc-900 md:border-l md:border-t-0">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-900 px-3 py-2">
              <span className="truncate font-mono text-[10px] text-zinc-500">
                {selectedPath}
              </span>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void saveFile()}
                className="inline-flex items-center gap-1 rounded bg-[#B5A075] px-2 py-1 text-[10px] font-bold text-zinc-950 disabled:opacity-40"
              >
                {saving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Save className="size-3" />
                )}
                保存
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              className="min-h-0 flex-1 resize-none bg-zinc-900/50 p-3 font-mono text-[11px] leading-relaxed text-zinc-300 outline-none"
              spellCheck={false}
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="border-t border-red-900/50 bg-red-950/30 px-3 py-2 text-[10px] text-red-400">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: VadFileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.kind === "directory") {
    return (
      <div>
        <button
          type="button"
          style={pad}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 py-1 text-left text-zinc-500 hover:text-zinc-300"
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <Folder className="size-3 shrink-0 text-[#B5A075]" />
          <span className="truncate">{node.name}</span>
        </button>
        {open
          ? node.children?.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))
          : null}
      </div>
    );
  }

  const editable = isEditableFile(node.path);
  return (
    <button
      type="button"
      style={pad}
      onClick={() => onSelect(node.path)}
      className={
        "flex w-full items-center gap-1.5 py-1 text-left " +
        (selectedPath === node.path
          ? "bg-zinc-900 text-[#B5A075]"
          : editable
            ? "text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200"
            : "text-zinc-600 cursor-default")
      }
    >
      <FileCode2 className="size-3 shrink-0" />
      <span className="truncate">{node.name}</span>
      {node.size != null ? (
        <span className="ml-auto pr-2 text-[9px] text-zinc-700">
          {(node.size / 1024).toFixed(1)}k
        </span>
      ) : null}
    </button>
  );
}
