import { nanoid } from "nanoid";

export type SpecializedStageStatus = "running" | "completed" | "failed";

export interface SpecializedStageCheckpoint<T = unknown> {
  id: string;
  workflowId: string;
  stage: string;
  status: SpecializedStageStatus;
  attempt: number;
  output?: T;
  error?: string;
  updatedAt: number;
}

export class SpecializedCheckpointStore {
  private checkpoints = new Map<string, SpecializedStageCheckpoint>();

  key(workflowId: string, stage: string): string {
    return `${workflowId}:${stage}`;
  }

  get<T>(workflowId: string, stage: string): SpecializedStageCheckpoint<T> | undefined {
    return this.checkpoints.get(this.key(workflowId, stage)) as SpecializedStageCheckpoint<T> | undefined;
  }

  save<T>(checkpoint: Omit<SpecializedStageCheckpoint<T>, "id" | "updatedAt"> & Partial<Pick<SpecializedStageCheckpoint<T>, "id" | "updatedAt">>): SpecializedStageCheckpoint<T> {
    const next = { id: checkpoint.id ?? nanoid(10), updatedAt: checkpoint.updatedAt ?? Date.now(), ...checkpoint } as SpecializedStageCheckpoint<T>;
    this.checkpoints.set(this.key(next.workflowId, next.stage), next);
    return next;
  }

  clear(workflowId?: string): void {
    if (!workflowId) {
      this.checkpoints.clear();
      return;
    }
    for (const key of this.checkpoints.keys()) if (key.startsWith(`${workflowId}:`)) this.checkpoints.delete(key);
  }

  list(workflowId?: string): SpecializedStageCheckpoint[] {
    return [...this.checkpoints.values()].filter((item) => !workflowId || item.workflowId === workflowId);
  }
}

export const specializedCheckpointStore = new SpecializedCheckpointStore();

export interface RunSpecializedStageOptions {
  workflowId: string;
  stage: string;
  resume?: boolean;
  maxRetries?: number;
  store?: SpecializedCheckpointStore;
  onCheckpoint?: (checkpoint: SpecializedStageCheckpoint) => void;
}

/** Runs a specialized stage with durable-in-process checkpoints and bounded retries. */
export async function runSpecializedStage<T>(
  fn: (attempt: number) => Promise<T>,
  options: RunSpecializedStageOptions,
): Promise<{ output: T; checkpoint: SpecializedStageCheckpoint<T> }> {
  const store = options.store ?? specializedCheckpointStore;
  const cached = options.resume ? store.get<T>(options.workflowId, options.stage) : undefined;
  if (cached?.status === "completed") return { output: cached.output as T, checkpoint: cached };

  const maxAttempts = Math.max(1, (options.maxRetries ?? 2) + 1);
  let lastError: unknown;
  for (let attempt = Math.max(1, (cached?.attempt ?? 0) + 1); attempt <= maxAttempts; attempt += 1) {
    const started = store.save<T>({ workflowId: options.workflowId, stage: options.stage, status: "running", attempt });
    options.onCheckpoint?.(started);
    try {
      const output = await fn(attempt);
      const completed = store.save<T>({ ...started, status: "completed", output, error: undefined, updatedAt: Date.now() });
      options.onCheckpoint?.(completed);
      return { output, checkpoint: completed };
    } catch (error) {
      lastError = error;
      const failed = store.save<T>({ ...started, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() });
      options.onCheckpoint?.(failed);
      if (attempt >= maxAttempts) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "specialized stage failed"));
}
