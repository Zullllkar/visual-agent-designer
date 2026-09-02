/**
 * Async Task Queue (PGMQ-compatible)
 * --------------------------------------------------------------
 * 进程内异步任务队列，模拟 PGMQ 的 API。
 * 支持：任务入队、Worker 消费、优先级、重试、超时。
 * 未来可平滑迁移到真实 PGMQ（Postgres Message Queue）。
 */

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface Task<TPayload = unknown> {
  id: string;
  queue: string;
  payload: TPayload;
  status: TaskStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: unknown;
}

export type TaskHandler<TPayload = unknown> = (
  task: Task<TPayload>
) => Promise<unknown>;

interface QueueOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  concurrency?: number;
}

class AsyncTaskQueue {
  private queues = new Map<string, Task[]>();
  private handlers = new Map<string, TaskHandler>();
  private options = new Map<string, Required<QueueOptions>>();
  private workers = new Map<string, boolean>();
  private counter = 0;

  /**
   * 注册队列处理器
   */
  registerQueue(
    queue: string,
    handler: TaskHandler,
    opts: QueueOptions = {}
  ): void {
    this.handlers.set(queue, handler);
    this.options.set(queue, {
      maxAttempts: opts.maxAttempts ?? 3,
      timeoutMs: opts.timeoutMs ?? 60_000,
      concurrency: opts.concurrency ?? 1,
    });
    if (!this.queues.has(queue)) {
      this.queues.set(queue, []);
    }
  }

  /**
   * 入队任务
   */
  enqueue<TPayload>(
    queue: string,
    payload: TPayload,
    priority = 0
  ): string {
    this.counter++;
    const id = `task-${queue}-${Date.now()}-${this.counter}`;
    const task: Task<TPayload> = {
      id,
      queue,
      payload,
      status: "pending",
      priority,
      attempts: 0,
      maxAttempts: this.options.get(queue)?.maxAttempts ?? 3,
      timeoutMs: this.options.get(queue)?.timeoutMs ?? 60_000,
      createdAt: new Date().toISOString(),
    };
    const q = this.queues.get(queue) ?? [];
    q.push(task);
    this.queues.set(queue, q);
    this.startWorker(queue);
    return id;
  }

  getTask(id: string): Task | undefined {
    for (const tasks of this.queues.values()) {
      const task = tasks.find((t) => t.id === id);
      if (task) return task;
    }
    return undefined;
  }

  listTasks(queue?: string): Task[] {
    if (queue) return this.queues.get(queue) ?? [];
    return Array.from(this.queues.values()).flat();
  }

  cancelTask(id: string): boolean {
    const task = this.getTask(id);
    if (!task || task.status === "running" || task.status === "completed") {
      return false;
    }
    task.status = "failed";
    task.error = "cancelled";
    task.completedAt = new Date().toISOString();
    return true;
  }

  private startWorker(queue: string): void {
    if (this.workers.get(queue)) return;
    this.workers.set(queue, true);
    this.runWorker(queue);
  }

  private async runWorker(queue: string): Promise<void> {
    const opts = this.options.get(queue);
    const handler = this.handlers.get(queue);
    if (!opts || !handler) {
      this.workers.set(queue, false);
      return;
    }

    const tasks = this.queues.get(queue) ?? [];

    while (true) {
      const pending = tasks
        .filter((t) => t.status === "pending")
        .sort((a, b) => b.priority - a.priority);

      if (pending.length === 0) {
        this.workers.set(queue, false);
        return;
      }

      const running = tasks.filter((t) => t.status === "running").length;
      const available = opts.concurrency - running;
      if (available <= 0) {
        await sleep(100);
        continue;
      }

      const batch = pending.slice(0, available);
      await Promise.allSettled(batch.map((task) => this.executeTask(task, handler)));
    }
  }

  private async executeTask(
    task: Task,
    handler: TaskHandler
  ): Promise<void> {
    task.status = "running";
    task.attempts++;
    task.startedAt = new Date().toISOString();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Task timeout (${task.timeoutMs}ms)`)),
        task.timeoutMs
      );
    });

    try {
      const result = await Promise.race([
        handler(task),
        timeoutPromise,
      ]);
      task.status = "completed";
      task.result = result;
      task.completedAt = new Date().toISOString();
    } catch (e) {
      const err = e as Error;
      if (task.attempts < task.maxAttempts) {
        task.status = "pending";
        task.error = err.message;
      } else {
        task.status = "failed";
        task.error = err.message;
        task.completedAt = new Date().toISOString();
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const taskQueue = new AsyncTaskQueue();
