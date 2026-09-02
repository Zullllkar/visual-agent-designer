/**
 * materialize 成本预估（可在 client / server 共用）
 */

/** 单槽生图成本粗估（USD） */
export const MATERIAL_SLOT_COST_USD = 0.04;
/** 拆解 / vision 固定成本粗估 */
export const MATERIALIZE_DECOMPOSE_COST_USD = 0.02;
/** 默认并行度 */
export const MATERIAL_GEN_CONCURRENCY = 3;

export function estimateMaterializeCostUsd(input: {
  mediaSlotCount: number;
  /** 是否需要重新拆解 IR */
  needsDecompose?: boolean;
  /** 预计实际调用生图的槽数；默认 = mediaSlotCount */
  generateSlotCount?: number;
}): {
  estimatedUsd: number;
  decomposeUsd: number;
  generationUsd: number;
  generateSlotCount: number;
} {
  const generateSlotCount = Math.max(
    0,
    input.generateSlotCount ?? input.mediaSlotCount
  );
  const decomposeUsd = input.needsDecompose
    ? MATERIALIZE_DECOMPOSE_COST_USD
    : 0;
  const generationUsd = generateSlotCount * MATERIAL_SLOT_COST_USD;
  return {
    estimatedUsd: roundUsd(decomposeUsd + generationUsd),
    decomposeUsd: roundUsd(decomposeUsd),
    generationUsd: roundUsd(generationUsd),
    generateSlotCount,
  };
}

function roundUsd(n: number): number {
  return Math.round(n * 1000) / 1000;
}
