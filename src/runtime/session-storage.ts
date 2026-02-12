import { Actor, log } from "apify";
import type { BrowserContext } from "playwright-core";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface SessionStorageConfig {
  enabled: boolean;
  storeName: string;
  keyPrefix: string;
}

interface PersistedSessionRecord {
  version: 1;
  updatedAt: string;
  storageState: StorageState;
}

export interface SessionStorageStatus {
  enabled: boolean;
  ready: boolean;
  storeName: string;
  keyPrefix: string;
}

export class SessionStorageManager {
  private readonly config: SessionStorageConfig;
  private store: Awaited<ReturnType<typeof Actor.openKeyValueStore>> | null = null;

  public constructor(config: SessionStorageConfig) {
    this.config = config;
  }

  public async init(): Promise<void> {
    if (!this.config.enabled) return;
    this.store = await Actor.openKeyValueStore(this.config.storeName);
    log.info("Session storage initialized.", {
      storeName: this.config.storeName,
      keyPrefix: this.config.keyPrefix,
    });
  }

  public getStatus(): SessionStorageStatus {
    return {
      enabled: this.config.enabled,
      ready: this.store !== null,
      storeName: this.config.storeName,
      keyPrefix: this.config.keyPrefix,
    };
  }

  public async load(slot: number): Promise<StorageState | undefined> {
    if (!this.config.enabled || !this.store) return undefined;

    const key = this.keyFor(slot);
    const record = await this.store.getValue<PersistedSessionRecord | null>(key);
    if (!record) return undefined;

    if (record.version !== 1 || !record.storageState) {
      log.warning("Invalid persisted session record, clearing slot.", { key });
      await this.store.setValue(key, null);
      return undefined;
    }

    return record.storageState;
  }

  public async save(slot: number, storageState: StorageState): Promise<void> {
    if (!this.config.enabled || !this.store) return;
    const key = this.keyFor(slot);

    const record: PersistedSessionRecord = {
      version: 1,
      updatedAt: new Date().toISOString(),
      storageState,
    };
    await this.store.setValue(key, record);
  }

  public async clear(slot: number): Promise<void> {
    if (!this.config.enabled || !this.store) return;
    await this.store.setValue(this.keyFor(slot), null);
  }

  private keyFor(slot: number): string {
    return `${this.config.keyPrefix}-${slot}`;
  }
}
