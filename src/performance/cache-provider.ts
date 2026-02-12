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

  public async close(): Promise<void> {
    this.store.clear();
  }
}

interface RedisLikeClient {
  connect(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
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
