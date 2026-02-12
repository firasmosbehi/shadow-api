import { Actor } from "apify";

export interface DeadLetterEntry {
  id: string;
  created_at: string;
  source: string;
  operation: string;
  request: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown> | null;
  };
  context: Record<string, unknown> | null;
}

export interface DeadLetterSnapshot {
  enabled: boolean;
  store_ready: boolean;
  total: number;
  recent: DeadLetterEntry[];
}

export interface DeadLetterQueueConfig {
  enabled: boolean;
  storeName: string;
  maxEntries: number;
}

export class DeadLetterQueue {
  private readonly config: DeadLetterQueueConfig;
  private store: Awaited<ReturnType<typeof Actor.openKeyValueStore>> | null = null;
  private readonly indexKey = "dlq-index";
  private index: string[] = [];
  private readonly entries = new Map<string, DeadLetterEntry>();

  public constructor(config: DeadLetterQueueConfig) {
    this.config = config;
  }

  public async init(): Promise<void> {
    if (!this.config.enabled) return;
    this.store = await Actor.openKeyValueStore(this.config.storeName);
    this.index = (await this.store.getValue<string[]>(this.indexKey)) ?? [];
    const warmIds = this.index.slice(0, Math.min(this.index.length, this.config.maxEntries));
    for (const id of warmIds) {
      const entry = await this.store.getValue<DeadLetterEntry | null>(this.keyFor(id));
      if (entry) this.entries.set(id, entry);
    }
  }

  public async push(entry: Omit<DeadLetterEntry, "id" | "created_at">): Promise<DeadLetterEntry | null> {
    if (!this.config.enabled || !this.store) return null;

    const now = new Date().toISOString();
    const id = `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: DeadLetterEntry = {
      id,
      created_at: now,
      ...entry,
    };
    const key = this.keyFor(id);

    await this.store.setValue(key, record);
    this.index.unshift(id);
    this.entries.set(id, record);

    while (this.index.length > this.config.maxEntries) {
      const removed = this.index.pop();
      if (removed) {
        await this.store.setValue(this.keyFor(removed), null);
        this.entries.delete(removed);
      }
    }
    await this.store.setValue(this.indexKey, this.index);
    return record;
  }

  public async snapshot(limit = 25): Promise<DeadLetterSnapshot> {
    if (!this.config.enabled || !this.store) {
      return {
        enabled: this.config.enabled,
        store_ready: false,
        total: 0,
        recent: [],
      };
    }

    const ids = this.index.slice(0, Math.max(1, limit));
    const recent: DeadLetterEntry[] = [];
    for (const id of ids) {
      const cached = this.entries.get(id);
      if (cached) {
        recent.push(cached);
        continue;
      }
      const entry = await this.store.getValue<DeadLetterEntry | null>(this.keyFor(id));
      if (entry) recent.push(entry);
      if (entry) this.entries.set(id, entry);
    }

    return {
      enabled: this.config.enabled,
      store_ready: true,
      total: this.index.length,
      recent,
    };
  }

  public snapshotSync(limit = 25): DeadLetterSnapshot {
    const ids = this.index.slice(0, Math.max(1, limit));
    const recent = ids
      .map((id) => this.entries.get(id))
      .filter((entry): entry is DeadLetterEntry => Boolean(entry));
    return {
      enabled: this.config.enabled,
      store_ready: this.store !== null,
      total: this.index.length,
      recent,
    };
  }

  private keyFor(id: string): string {
    return `dlq-entry-${id}`;
  }
}
