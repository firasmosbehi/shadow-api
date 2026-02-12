import { log } from "apify";

export interface CacheEnvelope<T> {
  value: T;
  writtenAt: number;
  expiresAt: number;
  staleUntil: number;
}

export interface CacheProvider<T> {
  readonly kind: "memory" | "redis";
  get(key: string): Promise<CacheEnvelope<T> | null>;
  set(key: string, value: CacheEnvelope<T>): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

class MemoryCacheProvider<T> implements CacheProvider<T> {
  public readonly kind = "memory" as const;
  private readonly store = new Map<string, CacheEnvelope<T>>();

  public async get(key: string): Promise<CacheEnvelope<T> | null> {
    return this.store.get(key) ?? null;
  }

  public async set(key: string, value: CacheEnvelope<T>): Promise<void> {
    this.store.set(key, value);
  }

  public async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }

  public async close(): Promise<void> {
    await this.clear();
  }
}

interface RedisLikeClient {
  connect(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

class RedisCacheProvider<T> implements CacheProvider<T> {
  public readonly kind = "redis" as const;
  private readonly client: RedisLikeClient;
  private readonly keyPrefix: string;

  public constructor(client: RedisLikeClient, keyPrefix: string) {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  public async get(key: string): Promise<CacheEnvelope<T> | null> {
    const raw = await this.client.get(this.keyFor(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CacheEnvelope<T>;
    } catch {
      return null;
    }
  }

  public async set(key: string, value: CacheEnvelope<T>): Promise<void> {
    const ttlMs = Math.max(1000, value.staleUntil - Date.now());
    await this.client.set(this.keyFor(key), JSON.stringify(value), { PX: ttlMs });
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(this.keyFor(key));
  }

  public async clear(): Promise<void> {
    const pattern = `${this.keyPrefix}:*`;
    const client = this.client as unknown as {
      scanIterator?: (options: { MATCH: string; COUNT: number }) => AsyncIterable<string>;
      keys?: (pattern: string) => Promise<string[]>;
      del: (key: string | string[]) => Promise<unknown>;
    };

    if (typeof client.scanIterator === "function") {
      const batch: string[] = [];
      for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
        batch.push(key);
        if (batch.length >= 500) {
          await client.del(batch);
          batch.length = 0;
        }
      }
      if (batch.length > 0) {
        await client.del(batch);
      }
      return;
    }

    if (typeof client.keys === "function") {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
      }
      return;
    }

    throw new Error("Redis client does not support scanIterator() or keys().");
  }

  public async close(): Promise<void> {
    await this.client.quit();
  }

  private keyFor(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }
}

export interface CacheProviderFactoryConfig {
  provider: "memory" | "redis";
  redisUrl: string | null;
  redisKeyPrefix: string;
}

export const createCacheProvider = async <T>(
  config: CacheProviderFactoryConfig,
): Promise<CacheProvider<T>> => {
  if (config.provider === "memory") {
    return new MemoryCacheProvider<T>();
  }

  if (!config.redisUrl) {
    log.warning("Redis cache requested but REDIS_URL is missing. Falling back to memory cache.");
    return new MemoryCacheProvider<T>();
  }

  try {
    const redisModule = (await import("redis") as unknown as {
      createClient: (options: { url: string }) => RedisLikeClient;
    });
    const client = redisModule.createClient({ url: config.redisUrl });
    await client.connect();
    log.info("Connected to Redis cache provider.", {
      redisKeyPrefix: config.redisKeyPrefix,
    });
    return new RedisCacheProvider<T>(client, config.redisKeyPrefix);
  } catch (error) {
    log.warning("Redis cache initialization failed. Falling back to memory cache.", {
      error: (error as Error).message,
    });
    return new MemoryCacheProvider<T>();
  }
};
