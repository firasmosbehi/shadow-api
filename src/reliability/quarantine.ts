import { SourceQuarantinedError } from "../runtime/errors";

interface QuarantineEntry {
  id: string;
  reason: string;
  until: number;
  details: Record<string, unknown> | null;
  at: number;
}

export interface QuarantineSnapshot {
  sources: Array<{
    source: string;
    reason: string;
    quarantined_until: string;
    details: Record<string, unknown> | null;
    quarantined_at: string;
  }>;
  proxies: Array<{
    proxy_id: string;
    reason: string;
    quarantined_until: string;
    details: Record<string, unknown> | null;
    quarantined_at: string;
  }>;
}

export class QuarantineRegistry {
  private readonly sourceEntries = new Map<string, QuarantineEntry>();
  private readonly proxyEntries = new Map<string, QuarantineEntry>();

  public assertSourceReady(source: string): void {
    this.pruneExpired();
    const key = source.trim().toLowerCase();
    const entry = this.sourceEntries.get(key);
    if (!entry) return;
    throw new SourceQuarantinedError(source, {
      source,
      reason: entry.reason,
      quarantined_until: new Date(entry.until).toISOString(),
      details: entry.details,
    });
  }

  public quarantineSource(
    source: string,
    reason: string,
    durationMs: number,
    details?: Record<string, unknown>,
  ): void {
    const key = source.trim().toLowerCase();
    this.sourceEntries.set(key, {
      id: key,
      reason,
      until: Date.now() + durationMs,
      details: details ?? null,
      at: Date.now(),
    });
  }

  public quarantineProxy(
    proxyId: string,
    reason: string,
    durationMs: number,
    details?: Record<string, unknown>,
  ): void {
    if (!proxyId) return;
    this.proxyEntries.set(proxyId, {
      id: proxyId,
      reason,
      until: Date.now() + durationMs,
      details: details ?? null,
      at: Date.now(),
    });
  }

  public snapshot(): QuarantineSnapshot {
    this.pruneExpired();
    return {
      sources: [...this.sourceEntries.entries()].map(([source, entry]) => ({
        source,
        reason: entry.reason,
        quarantined_until: new Date(entry.until).toISOString(),
        details: entry.details,
        quarantined_at: new Date(entry.at).toISOString(),
      })),
      proxies: [...this.proxyEntries.entries()].map(([proxyId, entry]) => ({
        proxy_id: proxyId,
        reason: entry.reason,
        quarantined_until: new Date(entry.until).toISOString(),
        details: entry.details,
        quarantined_at: new Date(entry.at).toISOString(),
      })),
    };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.sourceEntries.entries()) {
      if (entry.until <= now) this.sourceEntries.delete(key);
    }
    for (const [key, entry] of this.proxyEntries.entries()) {
      if (entry.until <= now) this.proxyEntries.delete(key);
    }
  }
}
