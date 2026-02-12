import { Actor, log } from "apify";
import type { AddressInfo } from "node:net";
import { buildRuntimeConfig, ConfigValidationError } from "./config";
import { createApiServer } from "./server";
import { BrowserPoolManager } from "./runtime/browser-pool";
import { StandbyLifecycleController } from "./runtime/standby-lifecycle";
import type { ActorInput } from "./types";

const closeServer = async (server: ReturnType<typeof createApiServer>): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const run = async (): Promise<void> => {
  await Actor.init();

  const input = ((await Actor.getInput()) ?? {}) as ActorInput;
  const runtime = buildRuntimeConfig(input);

  log.setLevel(log.LEVELS[runtime.logLevel]);
  const browserPool = new BrowserPoolManager({
    enabled: runtime.browserPoolEnabled,
    size: runtime.browserPoolSize,
    headless: runtime.browserHeadless,
    launchTimeoutMs: runtime.browserLaunchTimeoutMs,
  });

  const standby = new StandbyLifecycleController(browserPool, {
    enabled: runtime.standbyEnabled,
    idleTimeoutMs: runtime.standbyIdleTimeoutMs,
    tickIntervalMs: runtime.standbyTickIntervalMs,
    recycleAfterMs: runtime.standbyRecycleAfterMs,
    minWarmSessions: runtime.browserPoolSize,
  });

  await standby.start();

  const server = createApiServer(runtime, {
    getQueueDepth: () => 0,
    getWarmSessions: () => browserPool.getStatus().warmSessionCount,
    getStandbyMode: () => standby.getStatus().mode,
    getStandbyIdleMs: () => standby.getStatus().idleForMs,
    onActivity: () => standby.onActivity(),
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
    listeningAddress: address?.address ?? runtime.host,
  });

  Actor.on("aborting", async () => {
    log.warning("Actor abort signal received. Closing HTTP server.");
    await closeServer(server);
    await standby.stop();
    await Actor.exit();
  });

  Actor.on("migrating", async () => {
    log.warning("Actor migrating. Closing HTTP server.");
    await closeServer(server);
    await standby.stop();
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
