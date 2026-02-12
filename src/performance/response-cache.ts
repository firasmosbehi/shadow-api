import { createHash } from "node:crypto";
import type { FetchRequestInput } from "../extraction/types";
import type { CacheEnvelope, CacheProvider } from "./cache-provider";

export interface CacheStats {
  lookups: number;
  hits: number;
  misses: number;
  fresh_hits: number;
  stale_hits: number;
  writes: number;
  evictions: number;
}

export type CacheLookup<T> =
  | { state: "miss"; entry: null }
  | { state: "fresh"; entry: CacheEnvelope<T> }
  | { state: "stale"; entry: CacheEnvelope<T> };

const stableJson = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
};

const hash = (value: string): string => createHash("sha1").update(value).digest("hex");

const clone = <T>(value: T): T => structuredClone(value);

export const buildFetchCacheKey = (request: FetchRequestInput): string => {
  const normalized = {
    source: request.source.trim().toLowerCase(),
    operation: request.operation.trim().toLowerCase(),
    target: request.target,
    fields: request.fields ? [...request.fields].sort((a, b) => a.localeCompare(b)) : [],
    freshness: request.freshness ?? "hot",
    fast_mode: request.fast_mode === true,
  };
  return `fetch:${hash(stableJson(normalized))}`;
};

export interface ResponseCacheConfig<T> {
  provider: CacheProvider<T>;
  ttlMs: number;
  staleTtlMs: number;
  staleWhileRevalidate: boolean;
}

export class ResponseCache<T> {
  private readonly provider: CacheProvider<T>;
  private readonly ttlMs: number;
  private readonly staleTtlMs: number;
  private readonly staleWhileRevalidate: boolean;
  private readonly stats: CacheStats = {
    lookups: 0,
    hits: 0,
    misses: 0,
    fresh_hits: 0,
    stale_hits: 0,
    writes: 0,
    evictions: 0,
  };

  public constructor(config: ResponseCacheConfig<T>) {
    this.provider = config.provider;
    this.ttlMs = config.ttlMs;
    this.staleTtlMs = config.staleTtlMs;
    this.staleWhileRevalidate = config.staleWhileRevalidate;
  }

  public providerKind(): "memory" | "redis" {
    return this.provider.kind;
  }

  public staleWhileRevalidateEnabled(): boolean {
    return this.staleWhileRevalidate;
  }

  public ttl(): number {
    return this.ttlMs;
  }

  public staleTtl(): number {
    return this.staleTtlMs;
  }

  public getStats(): CacheStats {
    return { ...this.stats };
  }

  public async get(key: string): Promise<CacheLookup<T>> {
    this.stats.lookups += 1;
    const entry = await this.provider.get(key);
    if (!entry) {
      this.stats.misses += 1;
      return { state: "miss", entry: null };
    }

    const now = Date.now();
    if (now <= entry.expiresAt) {
      this.stats.hits += 1;
      this.stats.fresh_hits += 1;
      return { state: "fresh", entry: clone(entry) };
    }

    if (now <= entry.staleUntil) {
      this.stats.hits += 1;
      this.stats.stale_hits += 1;
      return { state: "stale", entry: clone(entry) };
    }

    this.stats.misses += 1;
    this.stats.evictions += 1;
    await this.provider.delete(key);
    return { state: "miss", entry: null };
  }

  public async set(key: string, value: T): Promise<void> {
    const now = Date.now();
    const envelope: CacheEnvelope<T> = {
      value: clone(value),
      writtenAt: now,
      expiresAt: now + this.ttlMs,
      staleUntil: now + this.ttlMs + this.staleTtlMs,
    };
    await this.provider.set(key, envelope);
    this.stats.writes += 1;
  }

  public async delete(key: string): Promise<void> {
    await this.provider.delete(key);
  }

  public async close(): Promise<void> {
    await this.provider.close();
  }
}
