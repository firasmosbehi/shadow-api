import type { AdapterHealthSnapshot } from "./types";

interface HealthAccumulator {
  source: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  blockedCount: number;
  latencySamples: number[];
  recentOutcomes: boolean[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastBlockedAt: string | null;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const nowIso = (): string => new Date().toISOString();

export class AdapterHealthTracker {
  private readonly store = new Map<string, HealthAccumulator>();

  public constructor(sources: string[] = []) {
    for (const source of sources) this.ensure(source);
  }

  public recordSuccess(source: string, latencyMs: number): void {
    const entry = this.ensure(source);
    entry.totalRequests += 1;
    entry.successCount += 1;
    entry.lastSuccessAt = nowIso();

    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      entry.latencySamples.push(latencyMs);
      if (entry.latencySamples.length > 100) entry.latencySamples.shift();
    }

    entry.recentOutcomes.push(true);
    if (entry.recentOutcomes.length > 12) entry.recentOutcomes.shift();
  }

  public recordFailure(
    source: string,
    params: { blocked?: boolean; latencyMs?: number } = {},
  ): void {
    const entry = this.ensure(source);
    entry.totalRequests += 1;
    entry.failureCount += 1;
    entry.lastFailureAt = nowIso();

    if (params.blocked) {
      entry.blockedCount += 1;
      entry.lastBlockedAt = nowIso();
    }

    if (Number.isFinite(params.latencyMs) && (params.latencyMs ?? 0) >= 0) {
      entry.latencySamples.push(params.latencyMs as number);
      if (entry.latencySamples.length > 100) entry.latencySamples.shift();
    }

    entry.recentOutcomes.push(false);
    if (entry.recentOutcomes.length > 12) entry.recentOutcomes.shift();
  }

  public snapshot(): AdapterHealthSnapshot[] {
    return [...this.store.values()]
      .map((entry) => this.toSnapshot(entry))
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  private ensure(source: string): HealthAccumulator {
    const key = source.trim().toLowerCase();
    const existing = this.store.get(key);
    if (existing) return existing;

    const created: HealthAccumulator = {
      source: key,
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      blockedCount: 0,
      latencySamples: [],
      recentOutcomes: [],
      lastSuccessAt: null,
      lastFailureAt: null,
      lastBlockedAt: null,
    };
    this.store.set(key, created);
    return created;
  }

  private toSnapshot(entry: HealthAccumulator): AdapterHealthSnapshot {
    const total = entry.totalRequests;
    const successRate = total > 0 ? entry.successCount / total : 1;
    const blockedRate = total > 0 ? entry.blockedCount / total : 0;
    const averageLatency =
      entry.latencySamples.length > 0
        ? entry.latencySamples.reduce((acc, current) => acc + current, 0) /
          entry.latencySamples.length
        : 0;

    let failureStreak = 0;
    for (let i = entry.recentOutcomes.length - 1; i >= 0; i -= 1) {
      if (entry.recentOutcomes[i]) break;
      failureStreak += 1;
    }

    const score = clamp(
      Math.round(successRate * 100 - blockedRate * 35 - failureStreak * 4),
      0,
      100,
    );

    const status: AdapterHealthSnapshot["status"] =
      total < 3
        ? "warming"
        : score >= 80
          ? "healthy"
          : score >= 60
            ? "degraded"
            : "unhealthy";

    return {
      source: entry.source,
      total_requests: total,
      success_count: entry.successCount,
      failure_count: entry.failureCount,
      blocked_count: entry.blockedCount,
      success_rate: Number(successRate.toFixed(3)),
      blocked_rate: Number(blockedRate.toFixed(3)),
      avg_latency_ms: Math.round(averageLatency),
      score,
      status,
      last_success_at: entry.lastSuccessAt,
      last_failure_at: entry.lastFailureAt,
      last_blocked_at: entry.lastBlockedAt,
    };
  }
}
