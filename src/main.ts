import { Actor, log } from "apify";
import type { AddressInfo } from "node:net";
import { buildRuntimeConfig } from "./config";
import { createApiServer } from "./server";
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
  const server = createApiServer(runtime);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(runtime.port, runtime.host, () => resolve());
  });

  const address = server.address() as AddressInfo | null;
  log.info("Shadow API scaffold started", {
    host: runtime.host,
    port: runtime.port,
    logLevel: runtime.logLevel,
    listeningAddress: address?.address ?? runtime.host,
  });

  Actor.on("aborting", async () => {
    log.warning("Actor abort signal received. Closing HTTP server.");
    await closeServer(server);
    await Actor.exit();
  });

  Actor.on("migrating", async () => {
    log.warning("Actor migrating. Closing HTTP server.");
    await closeServer(server);
  });
};

run().catch(async (error) => {
  log.exception(error as Error, "Actor bootstrap failed");
  await Actor.fail((error as Error).message);
});
