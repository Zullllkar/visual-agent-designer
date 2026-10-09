/**
 * 生成记录的纯数据：图片模型一次调用、LLM 一次调用。
 * 不保存参考图的 data URL 正文。
 */

export interface LedgerReference {
  kind: "url" | "inline";
  src?: string;
  mime?: string;
}

export interface ImageLedgerRecord {
  id: string;
  kind: "image";
  at: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  references: LedgerReference[];
  referenceIds?: string[];
  seed?: string;
  durationMs?: number;
  status: "succeeded" | "failed" | "cancelled";
  error?: string;
  assetId?: string;
}

export interface LlmLedgerRecord {
  id: string;
  kind: "llm";
  at: string;
  model: string;
  provider?: string;
  purpose?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs?: number;
  status: "succeeded" | "failed";
  error?: string;
}

export type GenerationRecord = ImageLedgerRecord | LlmLedgerRecord;

export interface ImageLedgerDraft {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceImages?: string[];
  referenceIds?: string[];
  seed?: string;
  durationMs?: number;
  status: ImageLedgerRecord["status"];
  error?: string;
  assetId?: string;
  at?: string;
}

export interface LlmLedgerDraft {
  model: string;
  provider?: string;
  purpose?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
  status?: LlmLedgerRecord["status"];
  error?: string;
  at?: string;
}

const PROMPT_LIMIT = 8000;
const URL_LIMIT = 500;

export function summarizeReferences(referenceImages?: string[]): LedgerReference[] {
  return (referenceImages ?? []).slice(0, 8).map((value) => {
    const trimmed = value.trim();
    if (trimmed.startsWith("data:")) {
      const mime = trimmed.slice(5, trimmed.indexOf(";")) || undefined;
      return { kind: "inline" as const, ...(mime ? { mime } : {}) };
    }
    if (/^https?:\/\//i.test(trimmed) && trimmed.length <= URL_LIMIT) {
      return { kind: "url" as const, src: trimmed };
    }
    if (trimmed.startsWith("/") && trimmed.length <= URL_LIMIT) {
      return { kind: "url" as const, src: trimmed };
    }
    return { kind: "inline" as const };
  });
}

export function buildImageLedgerRecord(id: string, draft: ImageLedgerDraft): ImageLedgerRecord {
  return {
    id,
    kind: "image",
    at: draft.at ?? new Date().toISOString(),
    model: draft.model || "unknown",
    prompt: draft.prompt.slice(0, PROMPT_LIMIT),
    ...(draft.negativePrompt ? { negativePrompt: draft.negativePrompt.slice(0, 500) } : {}),
    width: draft.width,
    height: draft.height,
    references: summarizeReferences(draft.referenceImages),
    ...(draft.referenceIds && draft.referenceIds.length > 0
      ? { referenceIds: draft.referenceIds.slice(0, 8) }
      : {}),
    ...(draft.seed ? { seed: draft.seed } : {}),
    ...(draft.durationMs != null ? { durationMs: draft.durationMs } : {}),
    status: draft.status,
    ...(draft.error ? { error: draft.error.slice(0, 500) } : {}),
    ...(draft.assetId ? { assetId: draft.assetId } : {}),
  };
}

export function buildLlmLedgerRecord(id: string, draft: LlmLedgerDraft): LlmLedgerRecord {
  const inputTokens = Math.max(0, Math.round(draft.inputTokens));
  const outputTokens = Math.max(0, Math.round(draft.outputTokens));
  return {
    id,
    kind: "llm",
    at: draft.at ?? new Date().toISOString(),
    model: draft.model || "unknown",
    ...(draft.provider ? { provider: draft.provider } : {}),
    ...(draft.purpose ? { purpose: draft.purpose } : {}),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(draft.durationMs != null ? { durationMs: draft.durationMs } : {}),
    status: draft.status ?? "succeeded",
    ...(draft.error ? { error: draft.error.slice(0, 500) } : {}),
  };
}

export interface AssetLedgerSource {
  id: string;
  prompt: string;
  model: string;
  width: number;
  height: number;
  seed?: string;
  durationMs?: number;
  createdAt: string;
  status?: string;
  error?: string;
  referenceAssetIds?: string[];
}

function assetStatus(status?: string): ImageLedgerRecord["status"] {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "succeeded";
}

export function imageRecordsFromAssets(assets: AssetLedgerSource[]): ImageLedgerRecord[] {
  return assets
    .filter(
      (asset) =>
        asset.model &&
        asset.model !== "pending" &&
        asset.prompt &&
        asset.status !== "generating"
    )
    .map((asset) =>
      buildImageLedgerRecord(`asset:${asset.id}`, {
        model: asset.model,
        prompt: asset.prompt,
        width: asset.width,
        height: asset.height,
        referenceIds: asset.referenceAssetIds,
        seed: asset.seed,
        durationMs: asset.durationMs,
        status: assetStatus(asset.status),
        error: asset.error,
        assetId: asset.id,
        at: asset.createdAt,
      })
    );
}

function sameShot(left: ImageLedgerRecord, right: ImageLedgerRecord): boolean {
  if (left.assetId && left.assetId === right.assetId) return true;
  return (
    left.model === right.model &&
    left.prompt === right.prompt &&
    left.width === right.width &&
    left.height === right.height &&
    Math.abs(Date.parse(left.at) - Date.parse(right.at)) < 120_000
  );
}

export function mergeImageRecords(
  ledger: ImageLedgerRecord[],
  assets: AssetLedgerSource[]
): ImageLedgerRecord[] {
  const extra = imageRecordsFromAssets(assets).filter(
    (asset) => !ledger.some((row) => sameShot(row, asset))
  );
  return [...ledger, ...extra].sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function sumLlmTokens(records: LlmLedgerRecord[]): {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  return records.reduce(
    (sum, record) => ({
      calls: sum.calls + 1,
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      totalTokens: sum.totalTokens + record.totalTokens,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );
}
