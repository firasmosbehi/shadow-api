import { log } from "apify";
import { QueueBackpressureError, QueueClosedError, QueueTimeoutError } from "./errors";

export interface RequestQueueConfig {
  concurrency: number;
  maxSize: number;
  taskTimeoutMs: number;
}

export interface RequestQueueStats {
  accepting: boolean;
  queued: number;
  inflight: number;
  completed: number;
  failed: number;
}

interface QueueTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const withTimeout = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new QueueTimeoutError({ timeoutMs }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export class AsyncRequestQueue {
  private readonly config: RequestQueueConfig;
  private readonly pending: Array<QueueTask<unknown>> = [];
  private inflight = 0;
  private accepting = true;
  private completed = 0;
  private failed = 0;
  private drainResolvers: Array<() => void> = [];

  public constructor(config: RequestQueueConfig) {
    this.config = config;
  }

  public getStats(): RequestQueueStats {
    return {
      accepting: this.accepting,
      queued: this.pending.length,
      inflight: this.inflight,
      completed: this.completed,
      failed: this.failed,
    };
  }

  public pause(): void {
    this.accepting = false;
  }

  public resume(): void {
    this.accepting = true;
    this.pump();
  }

  public async enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (!this.accepting) {
      throw new QueueClosedError(this.getStats() as unknown as Record<string, unknown>);
    }
    if (this.pending.length >= this.config.maxSize) {
      throw new QueueBackpressureError(this.getStats() as unknown as Record<string, unknown>);
    }

    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  public async drain(timeoutMs: number): Promise<void> {
    if (this.pending.length === 0 && this.inflight === 0) return;

    await withTimeout(
      new Promise<void>((resolve) => {
        this.drainResolvers.push(resolve);
      }),
      timeoutMs,
    );
  }

  private pump(): void {
    while (this.inflight < this.config.concurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) return;

      this.inflight += 1;
      void this.runTask(task);
    }
  }

  private async runTask(task: QueueTask<unknown>): Promise<void> {
    try {
      const result = await withTimeout(task.run(), this.config.taskTimeoutMs);
      this.completed += 1;
      task.resolve(result);
    } catch (error) {
      this.failed += 1;
      task.reject(error);
    } finally {
      this.inflight -= 1;
      this.pump();
      this.resolveDrainIfIdle();
    }
  }

  private resolveDrainIfIdle(): void {
    if (this.pending.length > 0 || this.inflight > 0) return;
    if (this.drainResolvers.length === 0) return;

    const resolvers = [...this.drainResolvers];
    this.drainResolvers = [];
    for (const resolve of resolvers) resolve();
    log.info("Request queue drained.");
  }
}
