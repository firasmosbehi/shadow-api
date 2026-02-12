import { log } from "apify";
import type { ExtractionResult, FetchRequestInput } from "../extraction/types";
import { InflightDeduper } from "./inflight-dedupe";
import { LatencyMetricsTracker } from "./latency-metrics";
import { buildFetchCacheKey, ResponseCache } from "./response-cache";

const clone = <T>(value: T): T => structuredClone(value);

interface NormalizedRequest {
  request: FetchRequestInput;
  fastMode: boolean;
  trimmedByFastMode: boolean;
}

const defaultFastFields = (source: string, operation: string): string[] => {
  const key = `${source.trim().toLowerCase()}:${operation.trim().toLowerCase()}`;
  if (key === "linkedin:profile") return ["full_name", "headline", "location"];
  if (key === "x:profile") return ["display_name", "handle", "follower_count"];
  if (key === "discord:server_metadata") return ["server_name", "member_count", "online_count"];
  return [];
};

const readBenchmarkTag = (target: Record<string, unknown>): string | undefined => {
  const value = target.benchmarkTag;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

export interface FetchPipelineConfig {
  executor: { execute: (request: FetchRequestInput) => Promise<ExtractionResult> };
  cache: ResponseCache<ExtractionResult>;
  fastModeEnabled: boolean;
  fastModeMaxFields: number;
  latencySampleWindow?: number;
}

export interface FetchPipelineReport {
  cache: ReturnType<ResponseCache<ExtractionResult>["getStats"]> & {
    provider: "memory" | "redis";
    ttl_ms: number;
    stale_ttl_ms: number;
    swr_enabled: boolean;
  };
  dedupe: ReturnType<InflightDeduper["getStats"]>;
  latency: ReturnType<LatencyMetricsTracker["snapshot"]>;
}

export class FetchPipeline {
  private readonly executor: { execute: (request: FetchRequestInput) => Promise<ExtractionResult> };
  private readonly cache: ResponseCache<ExtractionResult>;
  private readonly deduper = new InflightDeduper();
  private readonly latencyMetrics: LatencyMetricsTracker;
  private readonly fastModeEnabled: boolean;
  private readonly fastModeMaxFields: number;

  public constructor(config: FetchPipelineConfig) {
    this.executor = config.executor;
    this.cache = config.cache;
    this.fastModeEnabled = config.fastModeEnabled;
    this.fastModeMaxFields = config.fastModeMaxFields;
    this.latencyMetrics = new LatencyMetricsTracker(config.latencySampleWindow ?? 500);
  }

  public getReport(): FetchPipelineReport {
    return {
      cache: {
        ...this.cache.getStats(),
        provider: this.cache.providerKind(),
        ttl_ms: this.cache.ttl(),
        stale_ttl_ms: this.cache.staleTtl(),
        swr_enabled: this.cache.staleWhileRevalidateEnabled(),
      },
      dedupe: this.deduper.getStats(),
      latency: this.latencyMetrics.snapshot(),
    };
  }

  public async close(): Promise<void> {
    await this.cache.close();
  }

  public async prewarm(request: FetchRequestInput): Promise<void> {
    await this.execute({
      ...request,
      cache_mode: "refresh",
      fast_mode: true,
    });
  }

  public async execute(input: FetchRequestInput): Promise<ExtractionResult> {
    const startedAt = Date.now();
    const normalized = this.normalizeRequest(input);
    const cacheKey = buildFetchCacheKey(normalized.request);
    const cacheMode = normalized.request.cache_mode ?? "default";
    const pipelineStages: Record<string, number> = {};

    const cacheLookupStarted = Date.now();
    if (cacheMode !== "bypass" && cacheMode !== "refresh") {
      const lookup = await this.cache.get(cacheKey);
      pipelineStages.pipeline_cache_lookup_ms = Date.now() - cacheLookupStarted;

      if (lookup.state === "fresh" && lookup.entry) {
        const result = this.decorateCachedResult(
          clone(lookup.entry.value),
          normalized,
          cacheKey,
          "fresh",
          false,
          false,
          startedAt,
          pipelineStages,
        );
        return result;
      }

      if (
        lookup.state === "stale" &&
        lookup.entry &&
        this.cache.staleWhileRevalidateEnabled()
      ) {
        const revalidating = this.triggerBackgroundRefresh(cacheKey, normalized.request);
        const result = this.decorateCachedResult(
          clone(lookup.entry.value),
          normalized,
          cacheKey,
          "stale",
          true,
          revalidating,
          startedAt,
          pipelineStages,
        );
        return result;
      }
    } else {
      pipelineStages.pipeline_cache_lookup_ms = Date.now() - cacheLookupStarted;
    }

    const shouldWriteCache = cacheMode !== "bypass";
    const dedupeKey = cacheMode === "bypass" ? `bypass:${cacheKey}` : cacheKey;
    const dedupeStarted = Date.now();
    const run = this.deduper.run(dedupeKey, async () => {
      const extracted = await this.executor.execute(normalized.request);
      if (shouldWriteCache) {
        await this.cache.set(cacheKey, extracted);
      }
      return extracted;
    });

    const extracted = clone(await run.promise);
    pipelineStages.pipeline_dedupe_wait_ms = Date.now() - dedupeStarted;
    const result = this.decorateExtractedResult(
      extracted,
      normalized,
      cacheKey,
      run.deduped,
      shouldWriteCache ? "miss" : "miss",
      shouldWriteCache ? false : true,
      startedAt,
      pipelineStages,
    );
    return result;
  }

  private triggerBackgroundRefresh(key: string, request: FetchRequestInput): boolean {
    const run = this.deduper.run(key, async () => {
      const refreshed = await this.executor.execute({
        ...request,
        cache_mode: "refresh",
      });
      await this.cache.set(key, refreshed);
      return refreshed;
    });

    void run.promise.catch((error) => {
      log.warning("Background stale revalidation failed.", {
        cacheKey: key,
        source: request.source,
        operation: request.operation,
        error: (error as Error).message,
      });
    });
    return true;
  }

  private normalizeRequest(input: FetchRequestInput): NormalizedRequest {
    const fastMode = this.fastModeEnabled && input.fast_mode === true;
    if (!fastMode) {
      return {
        request: {
          ...input,
          cache_mode: input.cache_mode ?? "default",
        },
        fastMode: false,
        trimmedByFastMode: false,
      };
    }

    const max = this.fastModeMaxFields;
    const currentFields = input.fields ? [...input.fields] : [];
    let trimmedByFastMode = false;
    let fields = currentFields;

    if (fields.length === 0) {
      const defaults = defaultFastFields(input.source, input.operation);
      if (defaults.length > 0) {
        fields = defaults;
      }
    }

    if (fields.length > max) {
      fields = fields.slice(0, max);
      trimmedByFastMode = true;
    }

    return {
      request: {
        ...input,
        fields,
        fast_mode: true,
        cache_mode: input.cache_mode ?? "default",
      },
      fastMode: true,
      trimmedByFastMode,
    };
  }

  private decorateCachedResult(
    result: ExtractionResult,
    normalized: NormalizedRequest,
    cacheKey: string,
    cacheState: "fresh" | "stale",
    swr: boolean,
    revalidating: boolean,
    startedAt: number,
    pipelineStages: Record<string, number>,
  ): ExtractionResult {
    const total = Date.now() - startedAt;
    const stageLatencyMs = {
      ...result.stage_latency_ms,
      ...pipelineStages,
      pipeline_total_ms: total,
    };
    this.latencyMetrics.record(stageLatencyMs);

    const warnings = [...result.warnings];
    if (normalized.trimmedByFastMode) {
      warnings.push(`fast_mode_fields_trimmed:${this.fastModeMaxFields}`);
    }

    return {
      ...result,
      warnings,
      latency_ms: total,
      stage_latency_ms: stageLatencyMs,
      cache: {
        provider: this.cache.providerKind(),
        key: cacheKey,
        hit: true,
        state: cacheState,
        stale_while_revalidate: swr,
        revalidating,
        ttl_ms: this.cache.ttl(),
        stale_ttl_ms: this.cache.staleTtl(),
      },
      performance: {
        ...(result.performance ?? {}),
        deduped: false,
        fast_mode: normalized.fastMode,
        benchmark_tag: readBenchmarkTag(normalized.request.target),
      },
      fetched_at: new Date().toISOString(),
    };
  }

  private decorateExtractedResult(
    result: ExtractionResult,
    normalized: NormalizedRequest,
    cacheKey: string,
    deduped: boolean,
    cacheState: "miss",
    swr: boolean,
    startedAt: number,
    pipelineStages: Record<string, number>,
  ): ExtractionResult {
    const total = Date.now() - startedAt;
    const stageLatencyMs = {
      ...result.stage_latency_ms,
      ...pipelineStages,
      pipeline_total_ms: total,
    };
    this.latencyMetrics.record(stageLatencyMs);

    const warnings = [...result.warnings];
    if (normalized.trimmedByFastMode) {
      warnings.push(`fast_mode_fields_trimmed:${this.fastModeMaxFields}`);
    }

    return {
      ...result,
      warnings,
      latency_ms: total,
      stage_latency_ms: stageLatencyMs,
      cache: {
        provider: this.cache.providerKind(),
        key: cacheKey,
        hit: false,
        state: cacheState,
        stale_while_revalidate: swr,
        revalidating: false,
        ttl_ms: this.cache.ttl(),
        stale_ttl_ms: this.cache.staleTtl(),
      },
      performance: {
        ...(result.performance ?? {}),
        deduped,
        fast_mode: normalized.fastMode,
        benchmark_tag: readBenchmarkTag(normalized.request.target),
      },
      fetched_at: new Date().toISOString(),
    };
  }
}
