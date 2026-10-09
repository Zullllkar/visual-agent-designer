"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ImageAsset, ReferenceAsset } from "@/lib/project/assets-schema";
import {
  mergeImageRecords,
  sumLlmTokens,
  type GenerationRecord,
  type ImageLedgerRecord,
  type LlmLedgerRecord,
} from "@/lib/generation/ledger";

export function GenerationLedgerPanel({
  projectId,
  assets,
  references,
}: {
  projectId: string;
  assets?: ImageAsset[];
  references?: ReferenceAsset[];
}) {
  const [records, setRecords] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"image" | "llm">("image");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/generation-ledger`);
      const data = (await res.json()) as { records?: GenerationRecord[] };
      setRecords(data.records ?? []);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const images = useMemo(
    () =>
      mergeImageRecords(
        records.filter((record): record is ImageLedgerRecord => record.kind === "image"),
        assets ?? []
      ),
    [assets, records]
  );
  const llm = useMemo(
    () => records.filter((record): record is LlmLedgerRecord => record.kind === "llm"),
    [records]
  );
  const tokens = sumLlmTokens(llm);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="vad-inspector-toolbar">
        <div className="flex min-w-0 gap-1">
          <TabButton active={tab === "image"} onClick={() => setTab("image")}>
            图片 {images.length}
          </TabButton>
          <TabButton active={tab === "llm"} onClick={() => setTab("llm")}>
            模型 {llm.length}
          </TabButton>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="vad-agent-icon-btn disabled:opacity-40"
          aria-label="刷新生成记录"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </div>
      <div className="vad-inspector-scroll space-y-2 p-3">
        {tab === "image" ? (
          images.length === 0 ? (
            <Empty text="还没有图片生成记录。生图之后会留下模型、提示词、参考图和尺寸。" />
          ) : (
            images.map((record) => (
              <ImageRecordCard
                key={record.id}
                record={record}
                previewSrc={previewFor(record, assets)}
                references={references}
                assets={assets}
              />
            ))
          )
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="调用" value={String(tokens.calls)} />
              <Metric label="输入 token" value={formatTokens(tokens.inputTokens)} />
              <Metric label="输出 token" value={formatTokens(tokens.outputTokens)} />
            </div>
            {llm.length === 0 ? (
              <Empty text="还没有模型调用记录。对话和工具里的模型调用会记在这里。" />
            ) : (
              llm.map((record) => <LlmRecordCard key={record.id} record={record} />)
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ImageRecordCard({
  record,
  previewSrc,
  references,
  assets,
}: {
  record: ImageLedgerRecord;
  previewSrc?: string;
  references?: ReferenceAsset[];
  assets?: ImageAsset[];
}) {
  const refSrcs = referenceSrcs(record, references, assets);
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex gap-2">
        {previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[10px] text-[var(--muted)]">
            {record.width}×{record.height}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[12px] font-semibold">{record.model}</p>
            <Status status={record.status} />
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            {record.width}×{record.height}
            {record.seed ? ` · seed ${record.seed}` : ""}
            {record.durationMs != null ? ` · ${Math.max(1, Math.round(record.durationMs / 1000))}s` : ""}
          </p>
        </div>
      </div>
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[11px] leading-5 text-[var(--foreground)]">
        {record.prompt}
      </p>
      {record.negativePrompt ? (
        <p className="mt-1 text-[10px] text-[var(--muted)]">反向提示词：{record.negativePrompt}</p>
      ) : null}
      {refSrcs.length > 0 || record.references.some((item) => item.kind === "inline") ? (
        <div className="mt-2 flex items-center gap-1">
          {refSrcs.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="size-8 rounded object-cover" />
          ))}
          {record.references.some((item) => item.kind === "inline") ? (
            <span className="text-[10px] text-[var(--muted)]">
              内联参考图 {record.references.filter((item) => item.kind === "inline").length}
            </span>
          ) : null}
        </div>
      ) : null}
      {record.error ? <p className="mt-1 text-[10px] text-[var(--danger)]">{record.error}</p> : null}
    </article>
  );
}

function LlmRecordCard({ record }: { record: LlmLedgerRecord }) {
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{record.model}</p>
        <Status status={record.status === "failed" ? "failed" : "succeeded"} />
      </div>
      <p className="mt-1 text-[10px] text-[var(--muted)]">
        {record.purpose ?? "模型调用"}
        {record.provider ? ` · ${record.provider}` : ""}
        {record.durationMs != null ? ` · ${Math.max(1, Math.round(record.durationMs / 1000))}s` : ""}
      </p>
      <p className="mt-2 text-[11px]">
        输入 {formatTokens(record.inputTokens)} · 输出 {formatTokens(record.outputTokens)} · 合计{" "}
        {formatTokens(record.totalTokens)}
      </p>
      {record.error ? <p className="mt-1 text-[10px] text-[var(--danger)]">{record.error}</p> : null}
    </article>
  );
}

function previewFor(record: ImageLedgerRecord, assets?: ImageAsset[]): string | undefined {
  const asset = assets?.find((item) => item.id === record.assetId);
  return asset?.src;
}

function referenceSrcs(
  record: ImageLedgerRecord,
  references?: ReferenceAsset[],
  assets?: ImageAsset[]
): string[] {
  const urls = record.references.flatMap((item) => (item.kind === "url" && item.src ? [item.src] : []));
  const ids = (record.referenceIds ?? []).flatMap((id) => {
    const reference = references?.find((item) => item.id === id);
    if (reference) return [reference.src];
    const asset = assets?.find((item) => item.id === id);
    return asset ? [asset.src] : [];
  });
  return [...urls, ...ids].slice(0, 6);
}

function Status({ status }: { status: ImageLedgerRecord["status"] }) {
  const label = status === "succeeded" ? "成功" : status === "failed" ? "失败" : "取消";
  return <span className="shrink-0 text-[10px] text-[var(--muted)]">{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2">
      <p className="text-[10px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-[13px] font-semibold">{value}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2 py-1 text-[11px] ${active ? "bg-[var(--surface)] font-semibold text-[var(--foreground)]" : "text-[var(--muted)]"}`}
    >
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 py-6 text-[12px] leading-5 text-[var(--muted)]">{text}</p>;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
