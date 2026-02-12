export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
  windowMs: number;
}

interface WindowState {
  windowStart: number;
  count: number;
}

export interface FixedWindowRateLimiterConfig {
  windowMs: number;
  limit: number;
  maxEntries?: number;
}

export class FixedWindowRateLimiter {
  private readonly windowMs: number;
  private readonly limit: number;
  private readonly maxEntries: number;
  private readonly states = new Map<string, WindowState>();

  public constructor(config: FixedWindowRateLimiterConfig) {
    this.windowMs = Math.max(1, config.windowMs);
    this.limit = Math.max(1, config.limit);
    this.maxEntries = Math.max(100, config.maxEntries ?? 5000);
  }

  public check(key: string): RateLimitDecision {
    const now = Date.now();
    const normalizedKey = key.trim() || "anonymous";

    const state = this.ensureState(normalizedKey, now);
    const elapsed = now - state.windowStart;
    if (elapsed >= this.windowMs) {
      state.windowStart = now;
      state.count = 0;
    }

    state.count += 1;
    const allowed = state.count <= this.limit;
    const remaining = Math.max(0, this.limit - state.count);
    const retryAfterMs = allowed ? 0 : Math.max(0, this.windowMs - (now - state.windowStart));
    return {
      allowed,
      remaining,
      retryAfterMs,
      limit: this.limit,
      windowMs: this.windowMs,
    };
  }

  private ensureState(key: string, now: number): WindowState {
    const existing = this.states.get(key);
    if (existing) return existing;

    const created: WindowState = { windowStart: now, count: 0 };
    this.states.set(key, created);
    this.enforceMaxEntries();
    return created;
  }

  private enforceMaxEntries(): void {
    if (this.states.size <= this.maxEntries) return;
    // Best-effort pruning: drop oldest windows first.
    const entries = [...this.states.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    const toDrop = entries.slice(0, this.states.size - this.maxEntries);
    for (const [key] of toDrop) {
      this.states.delete(key);
    }
  }
}

