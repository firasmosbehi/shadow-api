export interface CheckpointStage {
  stage: string;
  at: string;
  details: Record<string, unknown> | null;
}

export interface CheckpointRecord {
  request_id: string;
  source: string;
  operation: string;
  status: "running" | "succeeded" | "failed";
  created_at: string;
  updated_at: string;
  stages: CheckpointStage[];
  error: Record<string, unknown> | null;
}

export interface CheckpointSnapshot {
  total: number;
  running: number;
  succeeded: number;
  failed: number;
  recent: CheckpointRecord[];
}

export class CheckpointStore {
  private readonly maxEntries: number;
  private readonly records = new Map<string, CheckpointRecord>();

  public constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  public start(requestId: string, source: string, operation: string): void {
    const now = new Date().toISOString();
    this.records.set(requestId, {
      request_id: requestId,
      source,
      operation,
      status: "running",
      created_at: now,
      updated_at: now,
      stages: [],
      error: null,
    });
    this.enforceLimit();
  }

  public stage(
    requestId: string,
    stage: string,
    details?: Record<string, unknown> | null,
  ): void {
    const record = this.records.get(requestId);
    if (!record) return;
    record.stages.push({
      stage,
      at: new Date().toISOString(),
      details: details ?? null,
    });
    record.updated_at = new Date().toISOString();
  }

  public succeed(requestId: string, details?: Record<string, unknown> | null): void {
    const record = this.records.get(requestId);
    if (!record) return;
    record.status = "succeeded";
    record.updated_at = new Date().toISOString();
    if (details) {
      record.stages.push({
        stage: "completed",
        at: record.updated_at,
        details,
      });
    }
  }

  public fail(requestId: string, error: Record<string, unknown>): void {
    const record = this.records.get(requestId);
    if (!record) return;
    record.status = "failed";
    record.error = error;
    record.updated_at = new Date().toISOString();
    record.stages.push({
      stage: "failed",
      at: record.updated_at,
      details: error,
    });
  }

  public snapshot(limit = 25): CheckpointSnapshot {
    const entries = [...this.records.values()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
    return {
      total: entries.length,
      running: entries.filter((entry) => entry.status === "running").length,
      succeeded: entries.filter((entry) => entry.status === "succeeded").length,
      failed: entries.filter((entry) => entry.status === "failed").length,
      recent: entries.slice(0, limit),
    };
  }

  private enforceLimit(): void {
    if (this.records.size <= this.maxEntries) return;
    const entries = [...this.records.values()].sort((a, b) =>
      a.updated_at.localeCompare(b.updated_at),
    );
    const toDelete = entries.slice(0, this.records.size - this.maxEntries);
    for (const entry of toDelete) {
      this.records.delete(entry.request_id);
    }
  }
}
