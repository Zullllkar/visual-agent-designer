/**
 * 项目生成记录：<project>/.vibeboard 或 .vad/projects/<id>/generation-ledger.jsonl
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { ensureDir } from "@/lib/vad/persist";
import { generationLedgerPath, projectDir } from "@/lib/vad/paths";
import {
  buildImageLedgerRecord,
  buildLlmLedgerRecord,
  type GenerationRecord,
  type ImageLedgerDraft,
  type LlmLedgerDraft,
} from "./ledger";

export async function appendGenerationRecord(
  projectId: string,
  record: GenerationRecord
): Promise<void> {
  await ensureDir(projectDir(projectId));
  await appendFile(generationLedgerPath(projectId), JSON.stringify(record) + "\n", "utf8");
}

export async function noteImageGeneration(
  projectId: string | undefined,
  draft: ImageLedgerDraft
): Promise<void> {
  if (!projectId) return;
  try {
    await appendGenerationRecord(projectId, buildImageLedgerRecord(randomUUID(), draft));
  } catch (error) {
    console.warn("[vad] image ledger", error);
  }
}

export async function noteLlmGeneration(
  projectId: string | undefined,
  draft: LlmLedgerDraft
): Promise<void> {
  if (!projectId) return;
  if (draft.inputTokens <= 0 && draft.outputTokens <= 0 && draft.status !== "failed") return;
  try {
    await appendGenerationRecord(projectId, buildLlmLedgerRecord(randomUUID(), draft));
  } catch (error) {
    console.warn("[vad] llm ledger", error);
  }
}

export async function readGenerationLedger(
  projectId: string,
  limit = 300
): Promise<GenerationRecord[]> {
  try {
    const raw = await readFile(generationLedgerPath(projectId), "utf8");
    const lines = raw.trim().split("\n").filter(Boolean).slice(-limit);
    const records: GenerationRecord[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as GenerationRecord;
        if (parsed?.kind === "image" || parsed?.kind === "llm") records.push(parsed);
      } catch {
        /* 跳过坏行 */
      }
    }
    return records.reverse();
  } catch {
    return [];
  }
}
