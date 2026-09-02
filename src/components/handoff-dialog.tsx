"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Code2,
  Copy,
  ImageIcon,
  Layers,
  Loader2,
  Package,
  Star,
  X,
} from "lucide-react";
import type { ImageAsset } from "@/lib/project/assets-schema";
import type { ProjectFile } from "@/lib/project/schema";
import type { HandoffTarget } from "@/lib/handoff/types";
import {
  countMediaSlots,
  countReadyMaterials,
  type MaterializationRecord,
} from "@/lib/handoff/layout-ir";
import { downloadHandoffZip } from "@/lib/handoff/client-download";
import { buildKickoffClipboardText } from "@/lib/handoff/kickoff-prompt";
import { buildHandoffPreflight } from "@/lib/handoff/preflight";
import {
  handoffDialogHint,
  handoffZipFootnote,
  isCodingHandoffPack,
  listHandoffDestinations,
  resolveHandoffPackKind,
} from "@/lib/handoff/pack-kind";
import {
  defaultHandoffSelection,
  listSelectableHandoffAssets,
  listSelectableHandoffReferences,
  loadPersistedHandoffSelection,
  projectWithHandoffSelection,
  sanitizeHandoffSelection,
  savePersistedHandoffSelection,
  type HandoffSelection,
} from "@/lib/handoff/select-assets";
import { McpQuickCopy } from "@/components/mcp-quick-copy";
import {
  ImageLightbox,
  PreviewableThumb,
  type ImageLightboxItem,
} from "@/components/image-lightbox";
import { useProviderStore } from "@/store/provider-store";

export function HandoffDialog({
  project,
  preferredTarget,
  onClose,
  onProjectUpdate,
}: {
  project: ProjectFile;
  preferredTarget?: HandoffTarget["name"];
  onClose: () => void;
  onProjectUpdate?: (project: ProjectFile) => void;
}) {
  const selectableAssets = useMemo(
    () => listSelectableHandoffAssets(project),
    [project]
  );
  const selectableRefs = useMemo(
    () => listSelectableHandoffReferences(project),
    [project]
  );

  const [selection, setSelection] = useState<HandoffSelection>(() => {
    const persisted = loadPersistedHandoffSelection(project.id);
    return sanitizeHandoffSelection(
      project,
      persisted ?? defaultHandoffSelection(project)
    );
  });
  const [busy, setBusy] = useState<HandoffTarget["name"] | null>(null);
  const [copied, setCopied] = useState<HandoffTarget["name"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [materializeBusy, setMaterializeBusy] = useState(false);
  const [preview, setPreview] = useState<ImageLightboxItem | null>(null);
  const providerConfig = useProviderStore((s) => s.config);
  const packKind = resolveHandoffPackKind(project);
  const codingPack = isCodingHandoffPack(packKind);
  const destinations = listHandoffDestinations(packKind);

  useEffect(() => {
    const persisted = loadPersistedHandoffSelection(project.id);
    setSelection(
      sanitizeHandoffSelection(
        project,
        persisted ?? defaultHandoffSelection(project)
      )
    );
  }, [project]);

  useEffect(() => {
    savePersistedHandoffSelection(project.id, selection);
  }, [project.id, selection]);

  const exportProject = useMemo(
    () => projectWithHandoffSelection(project, selection),
    [project, selection]
  );
  const preflight = useMemo(
    () =>
      buildHandoffPreflight(project, {
        selectedAssetIds: selection.assetIds,
        selectedReferenceIds: selection.referenceIds,
      }),
    [project, selection]
  );
  const needsMaterialize =
    preflight.checks.find((c) => c.id === "materials")?.level === "warning";
  const primaryMockupId = selection.assetIds[0];
  const materialMaps = useMemo(
    () => buildMaterialMaps(project, selection.assetIds),
    [project, selection.assetIds]
  );
  const materialStats = useMemo(() => {
    let mediaReady = 0;
    let mediaTotal = 0;
    let codeTotal = 0;
    let mockupsWithLayout = 0;
    for (const row of materialMaps) {
      mediaReady += row.mediaReady;
      mediaTotal += row.mediaTotal;
      codeTotal += row.codeTotal;
      if (row.record) mockupsWithLayout += 1;
    }
    return { mediaReady, mediaTotal, codeTotal, mockupsWithLayout };
  }, [materialMaps]);
  const packagePreview = useMemo(
    () =>
      buildPackagePreview(
        exportProject,
        selection.assetIds.length,
        selection.referenceIds.length,
        materialStats,
        packKind
      ),
    [
      exportProject,
      selection.assetIds.length,
      selection.referenceIds.length,
      materialStats,
      packKind,
    ]
  );
  const starredCount = selectableAssets.filter(
    (a) => a.status === "starred"
  ).length;
  const assetById = useMemo(() => {
    const map = new Map<string, ImageAsset>();
    for (const a of project.assets ?? []) map.set(a.id, a);
    return map;
  }, [project.assets]);

  const orderedTargets = useMemo(() => {
    if (!preferredTarget || !codingPack) return destinations;
    const preferred = destinations.filter((t) => t.id === preferredTarget);
    const rest = destinations.filter((t) => t.id !== preferredTarget);
    return [...preferred, ...rest];
  }, [preferredTarget, destinations, codingPack]);

  function toggleAsset(id: string) {
    setSelection((prev) => ({
      ...prev,
      assetIds: prev.assetIds.includes(id)
        ? prev.assetIds.filter((x) => x !== id)
        : [...prev.assetIds, id],
    }));
  }

  function toggleReference(id: string) {
    setSelection((prev) => ({
      ...prev,
      referenceIds: prev.referenceIds.includes(id)
        ? prev.referenceIds.filter((x) => x !== id)
        : [...prev.referenceIds, id],
    }));
  }

  function selectAllAssets() {
    setSelection((prev) => ({
      ...prev,
      assetIds: selectableAssets.map((a) => a.id),
    }));
  }

  function selectStarredOnly() {
    const starred = selectableAssets
      .filter((a) => a.status === "starred")
      .map((a) => a.id);
    setSelection((prev) => ({ ...prev, assetIds: starred }));
  }

  function clearAssets() {
    setSelection((prev) => ({ ...prev, assetIds: [] }));
  }

  function selectAllRefs() {
    setSelection((prev) => ({
      ...prev,
      referenceIds: selectableRefs.map((r) => r.id),
    }));
  }

  function clearRefs() {
    setSelection((prev) => ({ ...prev, referenceIds: [] }));
  }

  async function exportTarget(id: HandoffTarget["name"]) {
    if (!preflight.ok) {
      setError(
        selection.assetIds.length === 0
          ? "请至少勾选 1 张定稿素材再导出。"
          : "交付包缺少最终图片素材，无法下载。"
      );
      return;
    }
    setBusy(id);
    setError(null);
    try {
      await downloadHandoffZip(project, id, {
        selectedAssetIds: selection.assetIds,
        selectedReferenceIds: selection.referenceIds,
      });
      setExported(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function materializeSelectedMockup() {
    if (!primaryMockupId || materializeBusy) return;
    setMaterializeBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/materialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          assetId: primaryMockupId,
          providerConfig,
          skipGeneration: true,
          async: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      if (data.project && onProjectUpdate) {
        onProjectUpdate(data.project as ProjectFile);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMaterializeBusy(false);
    }
  }

  async function pollMaterializeJob(jobId: string) {
    while (true) {
      await new Promise((r) => setTimeout(r, 900));
      const res = await fetch(
        `/api/jobs/${jobId}?projectId=${encodeURIComponent(project.id)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      const job = data.job as {
        status: string;
        error?: string;
        result?: { updatedProject?: ProjectFile };
      };
      if (job.status === "completed") {
        const projectRes = await fetch(`/api/projects/${encodeURIComponent(project.id)}`);
        const projectData = await projectRes.json().catch(() => ({}));
        if (projectData.project && onProjectUpdate) {
          onProjectUpdate(projectData.project as ProjectFile);
        }
        return;
      }
      if (job.status === "failed") {
        throw new Error(job.error || "拆素材任务失败");
      }
      if (job.status === "cancelled") {
        throw new Error("拆素材任务已取消");
      }
    }
  }

  async function copyKickoff(id: HandoffTarget["name"]) {
    if (selection.assetIds.length === 0) {
      setError("请至少勾选 1 张定稿素材再复制 Prompt。");
      return;
    }
    setError(null);
    try {
      const text = buildKickoffClipboardText(exportProject, id);
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(
        () => setCopied((cur) => (cur === id ? null : cur)),
        2000
      );
    } catch (err) {
      setError((err as Error).message || "复制失败");
    }
  }

  return (
    <div
      className="app-dialog-overlay app-dialog-overlay-workspace"
      onClick={onClose}
    >
      <div
        className="app-dialog app-dialog-workspace"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Package className="size-5 app-accent-text" />
              导出 Handoff 包
            </h2>
            <p className="mt-1 text-xs app-subtle">
              {handoffDialogHint(packKind)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 app-subtle transition hover:bg-[var(--surface-muted)]"
            aria-label="关闭"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="handoff-workspace-main mt-3 min-h-0 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-0.5">
            {/* 定稿 */}
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">定稿整图</p>
                  <p className="mt-0.5 text-[11px] app-subtle">
                    已选 {selection.assetIds.length} / {selectableAssets.length}
                    {starredCount > 0 ? ` · 收藏 ${starredCount}` : ""}
                    {" · 写入 assets/final/"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={selectStarredOnly}
                    disabled={starredCount === 0}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                  >
                    仅收藏
                  </button>
                  <button
                    type="button"
                    onClick={selectAllAssets}
                    disabled={selectableAssets.length === 0}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={clearAssets}
                    disabled={selection.assetIds.length === 0}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                  >
                    清空
                  </button>
                </div>
              </div>
              {selectableAssets.length === 0 ? (
                <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300">
                  暂无可用整图。请先在画布生成并保留至少 1 张。
                </p>
              ) : (
                <ul className="mt-3 grid max-h-[240px] gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                  {selectableAssets.map((asset) => {
                    const checked = selection.assetIds.includes(asset.id);
                    const map = materialMaps.find((m) => m.mockupId === asset.id);
                    const hasVision = asset.designSpec?.source === "vision";
                    const missingSpec = !asset.designSpec;
                    return (
                      <li key={asset.id}>
                        <label
                          className={
                            "flex cursor-pointer gap-2.5 rounded-lg border px-2 py-2 transition " +
                            (missingSpec
                              ? "border-red-500/45 "
                              : checked
                                ? "border-[var(--primary)] "
                                : "border-[var(--border)] ") +
                            (checked
                              ? "bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                              : "bg-[var(--background)]/60 hover:bg-[var(--surface-muted)]/50")
                          }
                        >
                          <input
                            type="checkbox"
                            className="mt-1 size-3.5 shrink-0 accent-[var(--primary)]"
                            checked={checked}
                            onChange={() => toggleAsset(asset.id)}
                          />
                          <PreviewableThumb
                            src={asset.src}
                            className="size-14"
                            title={`定稿 ${asset.id.slice(0, 10)}`}
                            subtitle={`${asset.width}×${asset.height}`}
                            onPreview={setPreview}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 text-[11px] font-medium">
                              {asset.status === "starred" ? (
                                <Star className="size-3 fill-amber-400 text-amber-500" />
                              ) : null}
                              <span className="truncate font-mono text-[10px]">
                                {asset.id.slice(0, 8)}
                              </span>
                              <span className="tabular-nums app-subtle">
                                {asset.width}×{asset.height}
                              </span>
                            </span>
                            <span className="mt-0.5 line-clamp-2 text-[10px] leading-snug app-subtle">
                              {(asset.prompt || "视觉素材").slice(0, 72)}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-1 text-[9px]">
                              <span
                                className={
                                  "rounded px-1 py-0.5 font-medium " +
                                  (missingSpec
                                    ? "bg-red-500/15 text-red-700 dark:text-red-300"
                                    : hasVision
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                      : "bg-amber-500/15 text-amber-700 dark:text-amber-300")
                                }
                              >
                                {missingSpec
                                  ? "缺规格"
                                  : hasVision
                                    ? "规格 vision"
                                    : "规格 启发式"}
                              </span>
                              {map?.record ? (
                                <span className="rounded bg-sky-500/12 px-1 py-0.5 text-sky-800 dark:text-sky-200">
                                  拆解 {map.mediaReady}/{map.mediaTotal} 媒 ·{" "}
                                  {map.codeTotal} 码
                                </span>
                              ) : (
                                <span className="rounded bg-[var(--surface-muted)] px-1 py-0.5 app-subtle">
                                  未拆解
                                </span>
                              )}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 参考图 */}
            {selectableRefs.length > 0 ? (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/35 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold">参考图</p>
                    <p className="mt-0.5 text-[11px] app-subtle">
                      已选 {selection.referenceIds.length} /{" "}
                      {selectableRefs.length} · 写入 assets/references/
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={selectAllRefs}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={clearRefs}
                      disabled={selection.referenceIds.length === 0}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium disabled:opacity-40"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <ul className="mt-3 grid max-h-[120px] gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                  {selectableRefs.map((ref) => {
                    const checked = selection.referenceIds.includes(ref.id);
                    return (
                      <li key={ref.id}>
                        <label
                          className={
                            "flex cursor-pointer gap-2 rounded-lg border px-2 py-1.5 transition " +
                            (checked
                              ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                              : "border-[var(--border)] bg-[var(--background)]/60")
                          }
                        >
                          <input
                            type="checkbox"
                            className="mt-1 size-3.5 accent-[var(--primary)]"
                            checked={checked}
                            onChange={() => toggleReference(ref.id)}
                          />
                          <PreviewableThumb
                            src={ref.src}
                            className="size-9 rounded"
                            title={ref.label || "参考图"}
                            subtitle={`${ref.width}×${ref.height}`}
                            onPreview={setPreview}
                          />
                          <span className="min-w-0 text-[10px]">
                            <span className="block truncate font-medium">
                              {ref.label || "参考图"}
                            </span>
                            <span className="app-subtle">
                              {ref.width}×{ref.height}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {/* 拆解素材对应：仅界面视觉 / coding kickoff */}
            {codingPack ? (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <Layers className="size-3.5 app-accent-text" />
                    拆解素材对应
                  </p>
                  <p className="mt-0.5 text-[11px] app-subtle">
                    定稿整图 → 媒体槽 / 代码槽 → 独立材料（assets/materials/）
                    {materialStats.mockupsWithLayout > 0
                      ? ` · ${materialStats.mockupsWithLayout} 张已拆 · 媒 ${materialStats.mediaReady}/${materialStats.mediaTotal} · 码 ${materialStats.codeTotal}`
                      : " · 勾选的定稿尚未拆解"}
                  </p>
                </div>
                {needsMaterialize && primaryMockupId ? (
                  <button
                    type="button"
                    disabled={materializeBusy || busy !== null}
                    onClick={() => void materializeSelectedMockup()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-[11px] font-medium text-amber-800 disabled:opacity-50 dark:text-amber-200"
                  >
                    {materializeBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Layers className="size-3.5" />
                    )}
                    拆解首张勾选定稿
                  </button>
                ) : null}
              </div>

              {selection.assetIds.length === 0 ? (
                <p className="mt-3 text-[11px] app-subtle">先勾选至少 1 张定稿整图。</p>
              ) : (
                <ul className="mt-3 max-h-[min(340px,42vh)] space-y-3 overflow-y-auto">
                  {materialMaps.map((row) => (
                    <li
                      key={row.mockupId}
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)]/55 p-2.5"
                    >
                      <div className="flex items-start gap-2.5">
                        {row.mockup.src ? (
                          <PreviewableThumb
                            src={row.mockup.src}
                            className="size-14"
                            title={`整图 ${row.mockupId.slice(0, 10)}`}
                            subtitle={
                              row.record
                                ? `媒 ${row.mediaReady}/${row.mediaTotal} · 码 ${row.codeTotal}`
                                : "未拆解"
                            }
                            onPreview={setPreview}
                          />
                        ) : (
                          <span className="size-14 shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                            <span className="font-mono">{row.mockupId.slice(0, 10)}</span>
                            <ArrowRight className="size-3 app-subtle" />
                            {row.record ? (
                              <span className="app-subtle">
                                来源 {row.source} · 媒 {row.mediaReady}/
                                {row.mediaTotal} · 码 {row.codeTotal}
                              </span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-300">
                                尚未拆解 Layout IR
                              </span>
                            )}
                          </p>
                          {!row.record ? (
                            <p className="mt-1 text-[10px] app-subtle">
                              在画布对该图「拆解方案」或点上方按钮；确认后再生成独立素材。
                            </p>
                          ) : (
                            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                              {row.slots.map((slot) => {
                                const mat = slot.materialAssetId
                                  ? assetById.get(slot.materialAssetId)
                                  : undefined;
                                const thumb =
                                  mat?.src || slot.cropPreviewSrc || undefined;
                                return (
                                  <li
                                    key={slot.id}
                                    className="flex gap-2 rounded-md border border-[var(--border)]/80 bg-[var(--surface-muted)]/40 px-1.5 py-1.5"
                                  >
                                    {thumb ? (
                                      <PreviewableThumb
                                        src={thumb}
                                        className="size-10 rounded"
                                        title={`${slot.id} · ${slot.role}`}
                                        subtitle={
                                          slot.rebuildInCode
                                            ? "代码槽"
                                            : slot.status === "ready"
                                              ? "材料就绪"
                                              : "待生成 / crop"
                                        }
                                        onPreview={setPreview}
                                      />
                                    ) : (
                                      <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--border)] bg-[var(--background)]">
                                        {slot.rebuildInCode ? (
                                          <Code2 className="size-3.5 text-sky-600" />
                                        ) : (
                                          <ImageIcon className="size-3.5 app-subtle" />
                                        )}
                                      </span>
                                    )}
                                    <span className="min-w-0 flex-1 text-[10px]">
                                      <span className="flex flex-wrap items-center gap-1 font-medium">
                                        <code className="truncate">{slot.id}</code>
                                        <span className="rounded bg-[var(--background)] px-1 py-0.5 app-subtle">
                                          {slot.role}
                                        </span>
                                        <span
                                          className={
                                            "rounded px-1 py-0.5 " +
                                            (slot.rebuildInCode
                                              ? "bg-sky-500/15 text-sky-800 dark:text-sky-200"
                                              : slot.status === "ready"
                                                ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                                                : "bg-amber-500/15 text-amber-800 dark:text-amber-200")
                                          }
                                        >
                                          {slot.rebuildInCode
                                            ? "代码"
                                            : slot.status === "ready"
                                              ? "材料就绪"
                                              : "待生成"}
                                        </span>
                                      </span>
                                      <span className="mt-0.5 line-clamp-2 block app-subtle">
                                        {slot.rebuildInCode
                                          ? slot.copy || "rebuild in code"
                                          : slot.prompt.slice(0, 80)}
                                      </span>
                                      {!slot.rebuildInCode && mat ? (
                                        <span className="mt-0.5 block font-mono text-[9px] app-subtle">
                                          → {mat.id.slice(0, 10)} ·{" "}
                                          {mat.width}×{mat.height}
                                        </span>
                                      ) : null}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            ) : null}
          </div>

          {/* 右栏：预检 + 内容 + 导出 */}
          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)]/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">交付预检</p>
                  <p className="mt-0.5 text-[11px] app-subtle">
                    {preflight.finalAssetCount} 定稿 / {preflight.referenceCount}{" "}
                    参考
                  </p>
                </div>
                <span
                  className={
                    "shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold " +
                    (preflight.ok
                      ? preflight.warningCount > 0
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-red-500/10 text-red-700 dark:text-red-300")
                  }
                >
                  {preflight.ok
                    ? preflight.warningCount > 0
                      ? `${preflight.warningCount} 提醒`
                      : "可导出"
                    : `${preflight.blockedCount} 阻断`}
                </span>
              </div>
              <ul className="mt-3 max-h-[200px] space-y-1.5 overflow-y-auto">
                {preflight.checks.map((check) => (
                  <li
                    key={check.id}
                    className="flex gap-2 text-[11px] leading-relaxed"
                  >
                    {check.level === "ok" ? (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertTriangle
                        className={
                          "mt-0.5 size-3.5 shrink-0 " +
                          (check.level === "error"
                            ? "text-red-600"
                            : "text-amber-600")
                        }
                      />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">{check.label}</span>
                      <span className="app-subtle">：{check.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--background)]/55 p-3">
              <p className="text-xs font-semibold">交付内容</p>
              <div className="mt-2 grid gap-1.5 text-[11px]">
                {packagePreview.map((item) => (
                  <div
                    key={item.path}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--surface-muted)]/55 px-2 py-1.5"
                  >
                    <code className="min-w-0 truncate text-[10px]">
                      {item.path}
                    </code>
                    <span
                      className={
                        "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium " +
                        (item.ready
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-300")
                      }
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] p-3">
              <p className="mb-2 text-xs font-semibold">
                {codingPack ? "导出到" : "导出包"}
              </p>
              <ul className="space-y-2">
                {orderedTargets.map((t) => (
                  <li key={t.id}>
                    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {t.label}
                          {preferredTarget === t.id ? (
                            <span className="ml-1.5 text-[10px] font-normal app-subtle">
                              （推荐）
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[11px] app-subtle">{t.desc}</p>
                        <code className="text-[10px] app-subtle">{t.entry}</code>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {t.showKickoffCopy ? (
                        <button
                          type="button"
                          disabled={
                            busy !== null || selection.assetIds.length === 0
                          }
                          onClick={() => void copyKickoff(t.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[11px] font-medium disabled:opacity-50"
                        >
                          {copied === t.id ? (
                            <Check className="size-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          {copied === t.id ? "已复制" : "Prompt"}
                        </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy !== null || !preflight.ok}
                          onClick={() => void exportTarget(t.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {busy === t.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : null}
                          Zip
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {error ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                出错：{error}
              </p>
            ) : null}
            {exported ? (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Handoff 包已开始下载。
              </p>
            ) : null}
            <p className="text-[11px] leading-relaxed app-subtle">
              {handoffZipFootnote(packKind)}
            </p>
            <McpQuickCopy />
          </div>
        </div>
      </div>
      <ImageLightbox item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

type MaterialMapRow = {
  mockupId: string;
  mockup: ImageAsset;
  record: MaterializationRecord | null;
  source: string;
  mediaReady: number;
  mediaTotal: number;
  codeTotal: number;
  slots: Array<{
    id: string;
    role: string;
    rebuildInCode: boolean;
    status?: string;
    prompt: string;
    copy?: string;
    materialAssetId?: string;
    cropPreviewSrc?: string;
  }>;
};

function buildMaterialMaps(
  project: ProjectFile,
  selectedAssetIds: string[]
): MaterialMapRow[] {
  const assets = project.assets ?? [];
  return selectedAssetIds.map((mockupId) => {
    const mockup = assets.find((a) => a.id === mockupId);
    const record = project.materializations?.[mockupId] ?? null;
    if (!mockup) {
      return {
        mockupId,
        mockup: {
          id: mockupId,
          prompt: "",
          src: "",
          width: 0,
          height: 0,
          model: "",
          createdAt: "",
          status: "candidate",
        },
        record: null,
        source: "none",
        mediaReady: 0,
        mediaTotal: 0,
        codeTotal: 0,
        slots: [],
      };
    }
    if (!record) {
      return {
        mockupId,
        mockup,
        record: null,
        source: "none",
        mediaReady: 0,
        mediaTotal: 0,
        codeTotal: 0,
        slots: [],
      };
    }
    const mediaTotal = countMediaSlots(record.layout);
    const mediaReady = countReadyMaterials(record.layout);
    const codeTotal = record.layout.nodes.filter(
      (n) => n.rebuildInCode === true
    ).length;
    const slots = record.layout.nodes.map((node) => {
      if (node.rebuildInCode === false) {
        return {
          id: node.id,
          role: node.role,
          rebuildInCode: false as const,
          status: node.status,
          prompt: node.prompt,
          materialAssetId: node.materialAssetId,
          cropPreviewSrc: node.cropPreviewSrc,
        };
      }
      return {
        id: node.id,
        role: node.role,
        rebuildInCode: true as const,
        prompt: "",
        copy: node.copy,
      };
    });
    return {
      mockupId,
      mockup,
      record,
      source: record.layout.meta?.source ?? "unknown",
      mediaReady,
      mediaTotal,
      codeTotal,
      slots,
    };
  });
}

function buildPackagePreview(
  project: ProjectFile,
  selectedCount: number,
  referenceCount: number,
  materialStats: {
    mediaReady: number;
    mediaTotal: number;
    codeTotal: number;
    mockupsWithLayout: number;
  },
  packKind: ReturnType<typeof resolveHandoffPackKind>
): Array<{
  path: string;
  label: string;
  ready: boolean;
}> {
  if (packKind !== "code-kickoff") {
    const extras =
      packKind === "art-bible"
        ? [
            { path: "ART_BIBLE.md", label: "设定", ready: true },
            { path: "ASSET_USAGE.md", label: `${selectedCount} 张`, ready: selectedCount > 0 },
          ]
        : packKind === "media-pack"
          ? [
              { path: "COPY.md", label: "文案", ready: true },
              { path: "ASSET_USAGE.md", label: `${selectedCount} 张`, ready: selectedCount > 0 },
            ]
          : [
              { path: "STYLE_NOTES.md", label: "草稿", ready: true },
            ];
    return [
      { path: "README.md", label: packKind === "none" ? "草稿" : "必含", ready: true },
      ...extras,
      {
        path: "assets/final/*.png",
        label: `${selectedCount} 个`,
        ready: selectedCount > 0,
      },
      {
        path: "assets/references/*",
        label: `${referenceCount} 个`,
        ready: true,
      },
    ];
  }
  const hasLayout = materialStats.mockupsWithLayout > 0;
  const hasMaterials = materialStats.mediaReady > 0;
  return [
    { path: "README.md", label: "必含", ready: true },
    {
      path: "SPEC.md",
      label: project.brief ? "完整" : "待补",
      ready: Boolean(project.brief),
    },
    {
      path: "IMPLEMENTATION.md",
      label: project.designDirection ? "完整" : "待补",
      ready: Boolean(project.designDirection),
    },
    {
      path: "ASSET_MAP.md",
      label: `${selectedCount} 整图` + (hasMaterials ? `+${materialStats.mediaReady}材` : ""),
      ready: selectedCount > 0,
    },
    {
      path: "design/specs/*",
      label: `${selectedCount} 份`,
      ready: selectedCount > 0,
    },
    {
      path: "assets/final/*.png",
      label: `${selectedCount} 个`,
      ready: selectedCount > 0,
    },
    {
      path: "assets/materials/*",
      label: hasMaterials
        ? `${materialStats.mediaReady}/${materialStats.mediaTotal}`
        : materialStats.mediaTotal > 0
          ? `待生成 ${materialStats.mediaTotal}`
          : "建议拆",
      ready: hasMaterials,
    },
    {
      path: "design/layouts/*",
      label: hasLayout
        ? `${materialStats.mockupsWithLayout} IR · ${materialStats.codeTotal} 码槽`
        : "待拆",
      ready: hasLayout,
    },
    {
      path: "DESIGN.md / LAYOUT.md",
      label: hasLayout ? "完整" : "待拆",
      ready: hasLayout,
    },
    {
      path: "design/tokens.dtcg.json",
      label: "DTCG",
      ready: true,
    },
    {
      path: "assets/references/*",
      label: `${referenceCount} 个`,
      ready: true,
    },
    {
      path: "prompts/*-kickoff.md",
      label: "必含",
      ready: selectedCount > 0,
    },
  ];
}
