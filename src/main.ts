import { Actor, log } from "apify";
import type { AddressInfo } from "node:net";
import { buildRuntimeConfig, ConfigValidationError } from "./config";
import { createApiServer } from "./server";
import { BrowserPoolManager } from "./runtime/browser-pool";
import { AsyncRequestQueue } from "./runtime/request-queue";
import { SessionStorageManager } from "./runtime/session-storage";
import { StandbyLifecycleController } from "./runtime/standby-lifecycle";
import { ExtractionService } from "./extraction/service";
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

const run = async (): Promise<void> => {
  await Actor.init();

  const input = ((await Actor.getInput()) ?? {}) as ActorInput;
  const runtime = buildRuntimeConfig(input);

  log.setLevel(log.LEVELS[runtime.logLevel]);
  const sessionStorage = new SessionStorageManager({
    enabled: runtime.sessionStorageEnabled,
    storeName: runtime.sessionStoreName,
    keyPrefix: runtime.sessionStoreKeyPrefix,
  });
  await sessionStorage.init();

  const browserPool = new BrowserPoolManager({
    enabled: runtime.browserPoolEnabled,
    size: runtime.browserPoolSize,
    headless: runtime.browserHeadless,
    launchTimeoutMs: runtime.browserLaunchTimeoutMs,
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
    defaultTimeoutMs: runtime.requestQueueTaskTimeoutMs,
    maxTimeoutMs: Math.max(runtime.requestQueueTaskTimeoutMs, 120_000),
  });

  let shuttingDown = false;

  const server = createApiServer(runtime, {
    getQueueDepth: () => requestQueue.getStats().queued,
    getQueueInflight: () => requestQueue.getStats().inflight,
    getWarmSessions: () => browserPool.getStatus().warmSessionCount,
    getStandbyMode: () => standby.getStatus().mode,
    getStandbyIdleMs: () => standby.getStatus().idleForMs,
    getAdapterHealth: () => extractionService.getAdapterHealth(),
    isShuttingDown: () => shuttingDown,
    onActivity: () => standby.onActivity(),
    enqueueFetch: async (request) =>
      requestQueue.enqueue(async () => {
        await sleep(runtime.mockFetchDelayMs);
        return extractionService.execute(request);
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
