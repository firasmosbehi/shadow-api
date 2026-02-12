import { Actor, log } from "apify";
import type { AddressInfo } from "node:net";
import { buildRuntimeConfig, ConfigValidationError } from "./config";
import { createApiServer } from "./server";
import type { ExtractionResult, FetchRequestInput } from "./extraction/types";
import { BrowserPoolManager } from "./runtime/browser-pool";
import { AsyncRequestQueue } from "./runtime/request-queue";
import { SessionStorageManager } from "./runtime/session-storage";
import { StandbyLifecycleController } from "./runtime/standby-lifecycle";
import { ExtractionService } from "./extraction/service";
import { createCacheProvider } from "./performance/cache-provider";
import { FetchPipeline } from "./performance/fetch-pipeline";
import { PrewarmScheduler } from "./performance/prewarm-scheduler";
import { ResponseCache } from "./performance/response-cache";
import { installCorrelationLogging } from "./observability/correlation-log";
import { installLogRedaction } from "./security/secure-log";
import { CheckpointStore } from "./reliability/checkpoint-store";
import { CircuitBreakerRegistry } from "./reliability/circuit-breaker";
import { DeadLetterQueue } from "./reliability/dead-letter-queue";
import { FingerprintRotator } from "./reliability/fingerprint-rotation";
import { IncidentReporter } from "./reliability/incident-reporter";
import { RotatingProxyPool } from "./reliability/proxy-rotation";
import { QuarantineRegistry } from "./reliability/quarantine";
import { ResilientExecutor } from "./reliability/resilient-executor";
import type { ActorInput } from "./types";

const closeServer = async (server: ReturnType<typeof createApiServer>): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toPrewarmRequests = (targets: Array<Record<string, unknown>>): FetchRequestInput[] =>
  {
    const output: FetchRequestInput[] = [];
    for (const target of targets) {
      const source = typeof target.source === "string" ? target.source.trim() : "";
      const operation = typeof target.operation === "string" ? target.operation.trim() : "";
      const payload =
        target.target && typeof target.target === "object"
          ? (target.target as Record<string, unknown>)
          : null;
      if (!source || !operation || !payload) continue;

      const fields =
        Array.isArray(target.fields) && target.fields.every((entry) => typeof entry === "string")
          ? (target.fields as string[])
          : undefined;
      const timeoutMs = typeof target.timeout_ms === "number" ? target.timeout_ms : undefined;
      output.push({
        source,
        operation,
        target: payload,
        fields,
        timeout_ms: timeoutMs,
        cache_mode: "refresh" as const,
        fast_mode: true,
      });
    }
    return output;
  };

const run = async (): Promise<void> => {
  await Actor.init();

  const input = ((await Actor.getInput()) ?? {}) as ActorInput;
  const runtime = buildRuntimeConfig(input);

  log.setLevel(log.LEVELS[runtime.logLevel]);
  installLogRedaction(log as unknown as Record<string, unknown>, runtime.logRedactionEnabled);
  installCorrelationLogging(log as unknown as Record<string, unknown>, true);
  const sessionStorage = new SessionStorageManager({
    enabled: runtime.sessionStorageEnabled,
    storeName: runtime.sessionStoreName,
    keyPrefix: runtime.sessionStoreKeyPrefix,
    retentionMs: runtime.sessionStorageRetentionMs,
  });
  await sessionStorage.init();

  const browserPool = new BrowserPoolManager({
    enabled: runtime.browserPoolEnabled,
    size: runtime.browserPoolSize,
    headless: runtime.browserHeadless,
    launchTimeoutMs: runtime.browserLaunchTimeoutMs,
    optimizedFlagsEnabled: runtime.browserOptimizedFlagsEnabled,
    blockResources: runtime.browserBlockResources,
    sessionStorage,
  });

  const standby = new StandbyLifecycleController(browserPool, {
    enabled: runtime.standbyEnabled,
    idleTimeoutMs: runtime.standbyIdleTimeoutMs,
    tickIntervalMs: runtime.standbyTickIntervalMs,
    recycleAfterMs: runtime.standbyRecycleAfterMs,
    minWarmSessions: runtime.browserPoolSize,
  });

  await standby.start();

  const requestQueue = new AsyncRequestQueue({
    concurrency: runtime.requestQueueConcurrency,
    maxSize: runtime.requestQueueMaxSize,
    taskTimeoutMs: runtime.requestQueueTaskTimeoutMs,
  });
  const extractionService = new ExtractionService({
    defaultTimeoutMs: runtime.fetchTimeoutDefaultMs,
    maxTimeoutMs: runtime.fetchTimeoutMaxMs,
  });
  const circuitBreakers = new CircuitBreakerRegistry({
    enabled: runtime.circuitBreakerEnabled,
    failureThreshold: runtime.circuitFailureThreshold,
    openMs: runtime.circuitOpenMs,
    halfOpenSuccessThreshold: runtime.circuitHalfOpenSuccessThreshold,
  });
  const proxyPool = new RotatingProxyPool({
    enabled: runtime.proxyRotationEnabled,
    proxyUrls: runtime.proxyPoolUrls,
    quarantineMs: runtime.proxyQuarantineMs,
  });
  const fingerprintRotator = new FingerprintRotator({
    enabled: runtime.fingerprintRotationEnabled,
  });
  const quarantine = new QuarantineRegistry();
  const checkpointStore = new CheckpointStore(runtime.checkpointMaxEntries);
  const deadLetterQueue = new DeadLetterQueue({
    enabled: runtime.deadLetterEnabled,
    storeName: runtime.deadLetterStoreName,
    maxEntries: runtime.deadLetterMaxEntries,
    retentionMs: runtime.deadLetterRetentionMs,
  });
  await deadLetterQueue.init();
  const incidentReporter = new IncidentReporter({
    blockedSpikeThreshold: runtime.incidentBlockedSpikeThreshold,
    blockedSpikeWindowMs: runtime.incidentBlockedSpikeWindowMs,
    webhookUrl: runtime.incidentWebhookUrl,
    maxRecentEvents: 50,
  });
  const resilientExecutor = new ResilientExecutor({
    extractionService,
    retryConfig: {
      maxAttempts: runtime.retryMaxAttempts,
      baseDelayMs: runtime.retryBaseDelayMs,
      maxDelayMs: runtime.retryMaxDelayMs,
      blockedDelayMs: runtime.retryBlockedDelayMs,
      jitterMs: runtime.retryJitterMs,
    },
    circuitBreakers,
    proxyPool,
    fingerprintRotator,
    quarantine,
    checkpointStore,
    deadLetterQueue,
    incidentReporter,
    sourceQuarantineMs: runtime.sourceQuarantineMs,
    proxyQuarantineMs: runtime.proxyQuarantineMs,
    fallbackUrlStrategyEnabled: runtime.fallbackUrlStrategyEnabled,
  });
  const cacheProvider = await createCacheProvider<ExtractionResult>({
    provider: runtime.cacheProvider,
    redisUrl: runtime.redisUrl,
    redisKeyPrefix: runtime.redisKeyPrefix,
  });
  const responseCache = new ResponseCache({
    provider: cacheProvider,
    ttlMs: runtime.cacheTtlMs,
    staleTtlMs: runtime.cacheStaleTtlMs,
    staleWhileRevalidate: runtime.cacheSwrEnabled,
  });
  const fetchPipeline = new FetchPipeline({
    executor: resilientExecutor,
    cache: responseCache,
    fastModeEnabled: runtime.fastModeEnabled,
    fastModeMaxFields: runtime.fastModeMaxFields,
  });
  const prewarmScheduler = new PrewarmScheduler({
    enabled: runtime.prewarmEnabled,
    intervalMs: runtime.prewarmIntervalMs,
    targets: toPrewarmRequests(runtime.prewarmTargets),
    runRequest: async (request) => fetchPipeline.prewarm(request),
  });
  prewarmScheduler.start();

  let shuttingDown = false;

  const server = createApiServer(runtime, {
    getQueueDepth: () => requestQueue.getStats().queued,
    getQueueInflight: () => requestQueue.getStats().inflight,
    getWarmSessions: () => browserPool.getStatus().warmSessionCount,
    getStandbyMode: () => standby.getStatus().mode,
    getStandbyIdleMs: () => standby.getStatus().idleForMs,
    getAdapterHealth: () => extractionService.getAdapterHealth(),
    getPerformanceReport: () => ({
      pipeline: fetchPipeline.getReport(),
      prewarm: prewarmScheduler.getStats(),
    }),
    getReliabilityReport: () => resilientExecutor.snapshot(),
    purgeData: async () => {
      const results: Record<string, unknown> = {};

      try {
        await responseCache.purge();
        results.cache = { ok: true };
      } catch (error) {
        results.cache = { ok: false, error: (error as Error).message };
      }

      try {
        results.sessions = await sessionStorage.purgeSlots(runtime.browserPoolSize);
      } catch (error) {
        results.sessions = { ok: false, error: (error as Error).message };
      }

      try {
        results.dead_letter = await deadLetterQueue.purge();
      } catch (error) {
        results.dead_letter = { ok: false, error: (error as Error).message };
      }

      return results;
    },
    isShuttingDown: () => shuttingDown,
    onActivity: () => standby.onActivity(),
    enqueueFetch: async (request) =>
      requestQueue.enqueue(async () => {
        await sleep(runtime.mockFetchDelayMs);
        return fetchPipeline.execute(request);
      }),
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(runtime.port, runtime.host, () => resolve());
  });

  const address = server.address() as AddressInfo | null;
  log.info("Shadow API scaffold started", {
    host: runtime.host,
    port: runtime.port,
    logLevel: runtime.logLevel,
    browserPoolEnabled: runtime.browserPoolEnabled,
    standbyEnabled: runtime.standbyEnabled,
    sessionStorageEnabled: runtime.sessionStorageEnabled,
    queueConcurrency: runtime.requestQueueConcurrency,
    queueMaxSize: runtime.requestQueueMaxSize,
    queueTaskTimeoutMs: runtime.requestQueueTaskTimeoutMs,
    fetchTimeoutDefaultMs: runtime.fetchTimeoutDefaultMs,
    fetchTimeoutMinMs: runtime.fetchTimeoutMinMs,
    fetchTimeoutMaxMs: runtime.fetchTimeoutMaxMs,
    requestBodyMaxBytes: runtime.requestBodyMaxBytes,
    apiKeyEnabled: runtime.apiKeyEnabled,
    hmacSigningEnabled: runtime.hmacSigningEnabled,
    rateLimitEnabled: runtime.rateLimitEnabled,
    rateLimitWindowMs: runtime.rateLimitWindowMs,
    rateLimitGlobalMax: runtime.rateLimitGlobalMax,
    rateLimitIpMax: runtime.rateLimitIpMax,
    rateLimitApiKeyMax: runtime.rateLimitApiKeyMax,
    logRedactionEnabled: runtime.logRedactionEnabled,
    cacheProvider: runtime.cacheProvider,
    cacheTtlMs: runtime.cacheTtlMs,
    cacheStaleTtlMs: runtime.cacheStaleTtlMs,
    cacheSwrEnabled: runtime.cacheSwrEnabled,
    fastModeEnabled: runtime.fastModeEnabled,
    fastModeMaxFields: runtime.fastModeMaxFields,
    prewarmEnabled: runtime.prewarmEnabled,
    prewarmIntervalMs: runtime.prewarmIntervalMs,
    prewarmTargetsCount: runtime.prewarmTargets.length,
    browserOptimizedFlagsEnabled: runtime.browserOptimizedFlagsEnabled,
    browserBlockResources: runtime.browserBlockResources,
    proxyRotationEnabled: runtime.proxyRotationEnabled,
    proxyPoolSize: runtime.proxyPoolUrls.length,
    proxyQuarantineMs: runtime.proxyQuarantineMs,
    fingerprintRotationEnabled: runtime.fingerprintRotationEnabled,
    retryMaxAttempts: runtime.retryMaxAttempts,
    retryBaseDelayMs: runtime.retryBaseDelayMs,
    retryMaxDelayMs: runtime.retryMaxDelayMs,
    retryBlockedDelayMs: runtime.retryBlockedDelayMs,
    retryJitterMs: runtime.retryJitterMs,
    circuitBreakerEnabled: runtime.circuitBreakerEnabled,
    circuitFailureThreshold: runtime.circuitFailureThreshold,
    circuitOpenMs: runtime.circuitOpenMs,
    circuitHalfOpenSuccessThreshold: runtime.circuitHalfOpenSuccessThreshold,
    sourceQuarantineMs: runtime.sourceQuarantineMs,
    fallbackUrlStrategyEnabled: runtime.fallbackUrlStrategyEnabled,
    checkpointMaxEntries: runtime.checkpointMaxEntries,
    deadLetterEnabled: runtime.deadLetterEnabled,
    deadLetterStoreName: runtime.deadLetterStoreName,
    deadLetterMaxEntries: runtime.deadLetterMaxEntries,
    deadLetterRetentionMs: runtime.deadLetterRetentionMs,
    sessionStorageRetentionMs: runtime.sessionStorageRetentionMs,
    incidentBlockedSpikeThreshold: runtime.incidentBlockedSpikeThreshold,
    incidentBlockedSpikeWindowMs: runtime.incidentBlockedSpikeWindowMs,
    incidentWebhookEnabled: Boolean(runtime.incidentWebhookUrl),
    shutdownDrainTimeoutMs: runtime.shutdownDrainTimeoutMs,
    listeningAddress: address?.address ?? runtime.host,
  });

  const shutdown = async (reason: "aborting" | "migrating" | "signal"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    requestQueue.pause();
    log.warning("Shutdown started.", { reason });

    await closeServer(server);

    try {
      await requestQueue.drain(runtime.shutdownDrainTimeoutMs);
    } catch (error) {
      log.warning("Queue drain timed out during shutdown.", {
        reason,
        timeoutMs: runtime.shutdownDrainTimeoutMs,
        error: (error as Error).message,
      });
    }

    prewarmScheduler.stop();
    await fetchPipeline.close();
    await standby.stop();
  };

  Actor.on("aborting", async () => {
    await shutdown("aborting");
    await Actor.exit();
  });

  Actor.on("migrating", async () => {
    await shutdown("migrating");
  });

  process.on("SIGINT", () => {
    void shutdown("signal").then(async () => {
      await Actor.exit();
    });
  });
  process.on("SIGTERM", () => {
    void shutdown("signal").then(async () => {
      await Actor.exit();
    });
  });
};

run().catch(async (error) => {
  if (error instanceof ConfigValidationError) {
    log.error("Actor bootstrap failed due to invalid configuration.", {
      issues: error.issues,
    });
    await Actor.fail(error.message);
    return;
  }

  log.exception(error as Error, "Actor bootstrap failed");
  await Actor.fail((error as Error).message);
});
