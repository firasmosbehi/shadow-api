import { log } from "apify";
import type { FetchRequestInput } from "../extraction/types";

export interface PrewarmStats {
  enabled: boolean;
  running: boolean;
  configured_targets: number;
  runs: number;
  warmed_requests: number;
  failed_requests: number;
  last_run_at: string | null;
  last_run_duration_ms: number | null;
}

interface PrewarmSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  targets: FetchRequestInput[];
  runRequest: (request: FetchRequestInput) => Promise<unknown>;
}

export class PrewarmScheduler {
  private readonly config: PrewarmSchedulerConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private runs = 0;
  private warmedRequests = 0;
  private failedRequests = 0;
  private lastRunAt: string | null = null;
  private lastRunDurationMs: number | null = null;
  private tickInFlight = false;

  public constructor(config: PrewarmSchedulerConfig) {
    this.config = config;
  }

  public start(): void {
    if (!this.config.enabled) return;
    if (this.timer) return;

    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);
    void this.tick();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getStats(): PrewarmStats {
    return {
      enabled: this.config.enabled,
      running: this.running,
      configured_targets: this.config.targets.length,
      runs: this.runs,
      warmed_requests: this.warmedRequests,
      failed_requests: this.failedRequests,
      last_run_at: this.lastRunAt,
      last_run_duration_ms: this.lastRunDurationMs,
    };
  }

  private async tick(): Promise<void> {
    if (!this.running || this.tickInFlight) return;
    if (this.config.targets.length === 0) return;

    this.tickInFlight = true;
    const started = Date.now();
    this.lastRunAt = new Date().toISOString();
    this.runs += 1;

    for (const target of this.config.targets) {
      try {
        await this.config.runRequest(target);
        this.warmedRequests += 1;
      } catch (error) {
        this.failedRequests += 1;
        log.warning("Prewarm target request failed.", {
          source: target.source,
          operation: target.operation,
          error: (error as Error).message,
        });
      }
    }

    this.lastRunDurationMs = Date.now() - started;
    this.tickInFlight = false;
  }
}
