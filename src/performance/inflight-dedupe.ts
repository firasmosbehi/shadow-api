export interface InflightDedupeStats {
  inflight: number;
  dedupe_hits: number;
  executions: number;
}

export class InflightDeduper {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private dedupeHits = 0;
  private executions = 0;

  public getStats(): InflightDedupeStats {
    return {
      inflight: this.inflight.size,
      dedupe_hits: this.dedupeHits,
      executions: this.executions,
    };
  }

  public run<T>(key: string, task: () => Promise<T>): { promise: Promise<T>; deduped: boolean } {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.dedupeHits += 1;
      return { promise: existing, deduped: true };
    }

    this.executions += 1;
    const promise = task().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return { promise, deduped: false };
  }
}
