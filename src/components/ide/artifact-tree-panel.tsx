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
    <aside className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="vad-inspector-toolbar">
        <span className="truncate font-mono text-[11px] font-normal text-[var(--muted)]">
          .vad/projects/{projectId}/
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-[var(--muted)]">
              <Loader2 className="size-3.5 animate-spin" />
              加载文件树…
            </div>
          ) : tree.length === 0 ? (
            <div className="vad-inspector-empty">
              <div>
                <p className="text-[13px] font-medium tracking-[-0.02em]">
                  还没有工程文件
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                  生成素材后，这里会出现 project.json 和图片目录。
                </p>
              </div>
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
          <div className="vad-inspector-editor">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate font-mono text-[11px] text-[var(--muted)]">
                {selectedPath}
              </span>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void saveFile()}
                className="vad-inspector-quiet-btn disabled:opacity-40"
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
              spellCheck={false}
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="px-4 py-2 text-[12px] text-[var(--danger)]">{error}</p>
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
          className="vad-inspector-file"
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <Folder className="size-3 shrink-0 text-[var(--primary)]" />
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
        "vad-inspector-file " +
        (editable ? "" : "cursor-default opacity-50")
      }
      data-selected={selectedPath === node.path ? "true" : undefined}
    >
      <FileCode2 className="size-3 shrink-0" />
      <span className="truncate">{node.name}</span>
      {node.size != null ? (
        <span className="ml-auto pr-2 text-[10px] text-[var(--muted)]">
          {(node.size / 1024).toFixed(1)}k
        </span>
      ) : null}
    </button>
  );
}
