import { spawn } from "node:child_process";

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForEndpoint = async (url: string, timeoutMs: number): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // still booting
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for endpoint: ${url}`);
};

const run = async (): Promise<void> => {
  const port = Number(process.env.PORT ?? 3300);
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    BROWSER_POOL_ENABLED: "false",
    STANDBY_ENABLED: "false",
  };

  const child = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    env,
  });

  try {
    await waitForEndpoint(`${baseUrl}/v1/health`, 15000);

    const health = await (await fetch(`${baseUrl}/v1/health`)).json();
    const ready = await (await fetch(`${baseUrl}/v1/ready`)).json();
    const fetched = await (
      await fetch(`${baseUrl}/v1/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "x",
          operation: "profile",
          target: { handle: "openai" },
          fields: ["handle", "name"],
        }),
      })
    ).json();

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ health, ready, fetched }, null, 2));
  } finally {
    child.kill("SIGTERM");
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
