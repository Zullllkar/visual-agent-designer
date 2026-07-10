"use client";

/**
 * IDE ImagePane（C2c）
 * --------------------------------------------------------------
 * "Image Workspace"：用户输入 prompt → 调 image provider 生成 N 张候选 →
 * 候选写入 project.assets[]，可 Star、丢弃、拖拽到 tldraw 画布。
 *
 * 拖拽行为：
 *   - 拖入 CanvasPage：转换为 page.nodes[] 中的 image node
 *   - 拖入画布空白区：创建独立 ImageAsset shape
 *
 * 关键决策：
 *   - 候选图直接 base64 内联（data:image/png;base64,...）持久化到
 *     project-store。project-store 已迁移到 IndexedDB，避免真实
 *     image provider 生成大图后触发 localStorage quota。
 *   - 多张候选共享 batchId，便于 UI 折叠分组（暂未做折叠，先扁平列表）。
 *   - 生成中显示骨架占位（占位图框 + spinner），让用户感知进度。
 */

import { useState } from "react";
import {
  Check,
  ImageIcon,
  Loader2,
  Paperclip,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useProviderStore } from "@/store/provider-store";
import { useProjectStore } from "@/store/project-store";
import { useCanvasSelectionStore } from "@/store/canvas-selection-store";
import type { ProjectFile } from "@/lib/project/schema";
import type { ImageAsset, ReferenceAsset } from "@/lib/project/assets-schema";
import { applyAssetToImageNode } from "@/lib/project/asset-drop";

interface ImagePaneProps {
  project: ProjectFile | null;
}

const SIZE_PRESETS: Array<{
  label: string;
  width: number;
  height: number;
}> = [
  { label: "1:1 · 1024", width: 1024, height: 1024 },
  { label: "16:9 · 1792×1024", width: 1792, height: 1024 },
  { label: "9:16 · 1024×1792", width: 1024, height: 1792 },
];

export function ImagePane({ project }: ImagePaneProps) {
  const providerConfig = useProviderStore((s) => s.config);
  const upsert = useProjectStore((s) => s.upsert);
  const selection = useCanvasSelectionStore((s) => s.selection);

  const [prompt, setPrompt] = useState("");
  const [n, setN] = useState(4);
  const [sizeIdx, setSizeIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useSelectionAsReference, setUseSelectionAsReference] = useState(true);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);

  const assets = (project?.assets ?? []).filter((a) => a.status !== "discarded");
  const references = project?.references ?? [];
  const visualStyle = project?.brief?.visualStyle;
  const imageKind = providerConfig.image?.kind ?? "mock";
  const isMockImg = imageKind === "mock";
  const selectedImageTarget =
    project && selection?.projectId === project.id && selection.nodeId
      ? findSelectedImageNode(project, selection.pageId, selection.nodeId)
      : null;

  async function generate() {
    if (!project || !prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const size = SIZE_PRESETS[sizeIdx];
      const res = await fetch("/api/agents/image/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          n,
          width: size.width,
          height: size.height,
          visualStyle,
          referenceImages: buildReferenceImages({
            references,
            selectedReferenceIds,
            selectedImageSrc:
              useSelectionAsReference &&
              selectedImageTarget?.src &&
              isUsableReferenceImage(selectedImageTarget.src)
                ? selectedImageTarget.src
                : undefined,
          }),
          providerConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      const newAssets = data.assets as ImageAsset[];
      upsert({
        ...project,
        assets: [...(project.assets ?? []), ...newAssets],
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = (err as Error).message;
      // localStorage 写入失败（quota）常见，给提示
      if (msg.includes("quota") || msg.includes("QuotaExceeded")) {
        setError(
          "本地存储已满。请清理一些旧候选图，或切回 Mock 模式（占位图很小）。"
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleStar(id: string) {
    if (!project) return;
    upsert({
      ...project,
      assets: (project.assets ?? []).map((a) =>
        a.id === id
          ? { ...a, status: a.status === "starred" ? "candidate" : "starred" }
          : a
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  function discard(id: string) {
    if (!project) return;
    upsert({
      ...project,
      assets: (project.assets ?? []).filter((a) => a.id !== id),
      updatedAt: new Date().toISOString(),
    });
  }

  async function uploadReferences(files: FileList | null) {
    if (!project || !files?.length) return;
    setError(null);
    try {
      const nextRefs: ReferenceAsset[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const src = await fileToDataUrl(file);
        const size = await readImageSize(src);
        nextRefs.push({
          id: nanoid(10),
          label: file.name,
          src,
          width: size.width,
          height: size.height,
          source: "upload",
          createdAt: new Date().toISOString(),
        });
      }
      if (nextRefs.length === 0) return;
      upsert({
        ...project,
        references: [...(project.references ?? []), ...nextRefs],
        updatedAt: new Date().toISOString(),
      });
      setSelectedReferenceIds((ids) => [
        ...ids,
        ...nextRefs.map((ref) => ref.id),
      ]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function toggleReference(id: string) {
    setSelectedReferenceIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  }

  function applyToSelectedNode(assetId: string) {
    if (!project || !selectedImageTarget) return;
    const result = applyAssetToImageNode(
      project,
      assetId,
      selectedImageTarget.pageId,
      selectedImageTarget.nodeId
    );
    if (result) upsert(result.project);
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <ImageIcon className="size-4 text-zinc-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Image Workspace
          </span>
        </div>
        <span className="text-[10px] text-zinc-400">
          {isMockImg ? "Mock 模式" : "真实模型"}
        </span>
      </header>

      {!project ? (
        <div className="grid flex-1 place-items-center text-xs text-zinc-500">
          还没有项目数据
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── Prompt 输入 ── */}
          <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                visualStyle
                  ? `画一张 ${visualStyle} 风格的...`
                  : "描述你想生成的图（中英文均可）"
              }
              rows={2}
              className="w-full resize-none rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs leading-relaxed outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
            />
            <div className="mt-2 flex items-center gap-2">
              <select
                value={sizeIdx}
                onChange={(e) => setSizeIdx(Number(e.target.value))}
                className="rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-[11px] dark:border-zinc-800 dark:bg-zinc-900"
              >
                {SIZE_PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                className="rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-[11px] dark:border-zinc-800 dark:bg-zinc-900"
                title="生成张数"
              >
                {[1, 2, 4, 6, 8].map((v) => (
                  <option key={v} value={v}>
                    {v} 张
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={generate}
                disabled={!prompt.trim() || loading}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                {loading ? "生成中" : "生成"}
              </button>
            </div>
            {visualStyle ? (
              <p className="mt-1.5 text-[10px] text-zinc-400">
                自动注入风格前缀：<code>{visualStyle}</code>
              </p>
            ) : null}
            {selectedImageTarget?.src &&
            isUsableReferenceImage(selectedImageTarget.src) ? (
              <label className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={useSelectionAsReference}
                  onChange={(e) => setUseSelectionAsReference(e.target.checked)}
                  className="size-3 rounded border-zinc-300 text-zinc-900"
                />
                参考当前选中图片生成变体
              </label>
            ) : null}
            <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium text-zinc-500">
                  参考图
                </span>
                <label className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 text-[10px] text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  <Paperclip className="size-3" />
                  上传
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void uploadReferences(e.currentTarget.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              {references.length > 0 ? (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                  {references
                    .slice()
                    .reverse()
                    .map((ref) => {
                      const selected = selectedReferenceIds.includes(ref.id);
                      return (
                        <button
                          key={ref.id}
                          type="button"
                          onClick={() => toggleReference(ref.id)}
                          className={
                            "relative size-12 shrink-0 overflow-hidden rounded border " +
                            (selected
                              ? "border-zinc-900 ring-2 ring-zinc-900/20 dark:border-white dark:ring-white/20"
                              : "border-zinc-200 opacity-70 hover:opacity-100 dark:border-zinc-800")
                          }
                          title={ref.label}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ref.src}
                            alt={ref.label}
                            className="size-full object-cover"
                          />
                          {selected ? (
                            <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-zinc-950 text-white">
                              <Check className="size-2.5" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] text-zinc-400">
                  上传参考图后，可让生成结果延续构图、主体或质感。
                </p>
              )}
            </div>
            {error ? (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          {/* ── 候选图列表 ── */}
          <div className="flex-1 overflow-y-auto p-3">
            {assets.length === 0 && !loading ? (
              <EmptyHint />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {loading
                  ? Array.from({ length: n }).map((_, i) => (
                      <SkeletonTile key={`skel-${i}`} />
                    ))
                  : null}
                {assets
                  .slice()
                  .reverse()
                  .map((a) => (
                    <AssetTile
                      key={a.id}
                      asset={a}
                      onStar={() => toggleStar(a.id)}
                      onDiscard={() => discard(a.id)}
                      onApplyToSelection={
                        selectedImageTarget
                          ? () => applyToSelectedNode(a.id)
                          : undefined
                      }
                    />
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <Sparkles className="mx-auto size-5 text-zinc-300" />
        <p className="mt-2 text-xs text-zinc-500">还没生成候选图</p>
        <p className="mt-1 text-[10px] text-zinc-400">
          在上方输入 prompt，选择尺寸和张数，点击「生成」
        </p>
      </div>
    </div>
  );
}

function SkeletonTile() {
  return (
    <div className="aspect-square animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
  );
}

function AssetTile({
  asset,
  onStar,
  onDiscard,
  onApplyToSelection,
}: {
  asset: ImageAsset;
  onStar: () => void;
  onDiscard: () => void;
  onApplyToSelection?: () => void;
}) {
  const isGenerating = asset.status === "generating";
  const isStarred = asset.status === "starred";

  // 拖到画布空白处会放置为独立 image-asset 素材卡
  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.effectAllowed = "copy";
    // 只传 assetId；接收方从 project.assets 反查完整数据，避免 dataTransfer 体积过大
    e.dataTransfer.setData(
      "application/x-vad-asset",
      JSON.stringify({ assetId: asset.id })
    );
    // 同时 set text/plain 作为 fallback（部分浏览器需要）
    e.dataTransfer.setData("text/plain", asset.id);
  }

  return (
    <div
      className={
        "group relative overflow-hidden rounded-md border bg-zinc-50 dark:bg-zinc-900 " +
        (isGenerating
          ? "border-[var(--primary)]/30 animate-pulse"
          : "border-zinc-200 dark:border-zinc-800")
      }
      draggable={!isGenerating}
      onDragStart={isGenerating ? undefined : handleDragStart}
      title={isGenerating ? "生图进行中" : "拖到画布的某一页即可使用"}
    >
      {/* 缩略：用 aspect-square 框 + object-cover */}
      <div className="relative aspect-square cursor-grab active:cursor-grabbing">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.src}
          alt={asset.prompt}
          className="size-full object-cover"
          loading="lazy"
          draggable={false}
        />
        {isGenerating ? (
          <div className="absolute inset-0 grid place-items-center bg-black/20 text-[10px] font-semibold text-white">
            生成中…
          </div>
        ) : null}
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onStar}
            className={
              "grid size-6 place-items-center rounded-md backdrop-blur " +
              (isStarred
                ? "bg-amber-400 text-white"
                : "bg-white/90 text-zinc-700 hover:bg-white dark:bg-zinc-900/90 dark:text-zinc-300")
            }
            title={isStarred ? "取消收藏" : "收藏"}
          >
            <Star className="size-3" />
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="grid size-6 place-items-center rounded-md bg-white/90 text-zinc-700 backdrop-blur hover:bg-white dark:bg-zinc-900/90 dark:text-zinc-300"
            title="删除"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
        {isStarred ? (
          <div className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-amber-400 text-white shadow">
            <Star className="size-2.5" />
          </div>
        ) : null}
        {!isGenerating && onApplyToSelection ? (
          <button
            type="button"
            onClick={onApplyToSelection}
            className="absolute bottom-1 left-1 inline-flex h-6 items-center gap-1 rounded-md bg-zinc-950/85 px-2 text-[10px] font-medium text-white opacity-0 backdrop-blur transition-opacity hover:bg-zinc-900 group-hover:opacity-100"
            title="应用到当前选中的图片节点"
          >
            <Check className="size-3" />
            应用
          </button>
        ) : null}
      </div>
      <div className="px-1.5 py-1">
        <p className="line-clamp-1 text-[10px] text-zinc-500" title={asset.prompt}>
          {asset.prompt}
        </p>
        <p className="text-[9px] text-zinc-400" title={asset.model}>
          {asset.model.split("::").pop()}
          {asset.durationMs != null ? ` · ${(asset.durationMs / 1000).toFixed(1)}s` : ""}
        </p>
      </div>
    </div>
  );
}

function findSelectedImageNode(
  project: ProjectFile,
  pageId: string,
  nodeId: string
): { pageId: string; nodeId: string; src: string } | null {
  const page = project.pages.find((p) => p.id === pageId);
  const node = page?.nodes.find((n) => n.id === nodeId);
  return node?.type === "image" ? { pageId, nodeId, src: node.src } : null;
}

function isUsableReferenceImage(src: string): boolean {
  if (src.startsWith("data:image/svg+xml")) return false;
  return src.startsWith("data:image/") || /^https?:\/\//i.test(src);
}

function buildReferenceImages({
  references,
  selectedReferenceIds,
  selectedImageSrc,
}: {
  references: ReferenceAsset[];
  selectedReferenceIds: string[];
  selectedImageSrc?: string;
}): string[] | undefined {
  const selected = references
    .filter((ref) => selectedReferenceIds.includes(ref.id))
    .map((ref) => ref.src);
  const all = [...selected, ...(selectedImageSrc ? [selectedImageSrc] : [])];
  const unique = Array.from(new Set(all)).filter(isUsableReferenceImage);
  return unique.length > 0 ? unique.slice(0, 4) : undefined;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("参考图读取失败"));
    reader.readAsDataURL(file);
  });
}

function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || 1024,
        height: image.naturalHeight || 1024,
      });
    image.onerror = () => reject(new Error("参考图尺寸读取失败"));
    image.src = src;
  });
}
