import { log } from "apify";
import { BrowserPoolManager } from "./browser-pool";

export interface StandbyLifecycleConfig {
  enabled: boolean;
  idleTimeoutMs: number;
  tickIntervalMs: number;
  recycleAfterMs: number;
  minWarmSessions: number;
}

type StandbyMode = "disabled" | "active" | "standby";

export interface StandbyLifecycleStatus {
  enabled: boolean;
  mode: StandbyMode;
  idleForMs: number;
  lastActivityAt: string;
}

export class StandbyLifecycleController {
  private readonly pool: BrowserPoolManager;
  private readonly config: StandbyLifecycleConfig;
  private mode: StandbyMode;
  private lastActivityAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(pool: BrowserPoolManager, config: StandbyLifecycleConfig) {
    this.pool = pool;
    this.config = config;
    this.mode = config.enabled ? "active" : "disabled";
  }

  public async start(): Promise<void> {
    this.running = true;
    if (!this.config.enabled) {
      log.warning("Standby lifecycle controller disabled by configuration.");
      return;
    }

    await this.pool.start();
    await this.pool.ensureWarmSessions(this.config.minWarmSessions);

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.tickIntervalMs);
  }

  public onActivity(): void {
    this.lastActivityAt = Date.now();
    if (this.config.enabled) {
      this.mode = "active";
    }
  }

  public getStatus(): StandbyLifecycleStatus {
    return {
      enabled: this.config.enabled,
      mode: this.mode,
      idleForMs: Date.now() - this.lastActivityAt,
      lastActivityAt: new Date(this.lastActivityAt).toISOString(),
    };
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.pool.stop();
  }

  private async tick(): Promise<void> {
    if (!this.running || !this.config.enabled) return;

    const idleMs = Date.now() - this.lastActivityAt;
    if (idleMs >= this.config.idleTimeoutMs) {
      this.mode = "standby";
      await this.pool.shrinkTo(this.config.minWarmSessions);
    } else {
      this.mode = "active";
      await this.pool.ensureWarmSessions(this.config.minWarmSessions);
    }

    await this.pool.warmAll();
    await this.pool.recycleStale(this.config.recycleAfterMs);
  }
}
