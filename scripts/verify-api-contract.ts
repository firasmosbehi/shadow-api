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
    await sleep(250);
  }
  throw new Error(`Timed out waiting for endpoint: ${url}`);
};

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const hasMeta = (payload: unknown): boolean => {
  if (!payload || typeof payload !== "object") return false;
  const meta = (payload as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object") return false;
  const requestId = (meta as Record<string, unknown>).request_id;
  return typeof requestId === "string" && requestId.startsWith("req_");
};

const run = async (): Promise<void> => {
  const port = 3400;
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiKey = "local-test-key";
  const mockXHtml = `
    <html><body>
      <div data-testid="UserName"><span>OpenAI</span><span>@OpenAI</span></div>
      <div data-testid="UserDescription">Building safe AGI.</div>
      <div data-testid="UserLocation">San Francisco, CA</div>
      <a href="/openai/followers"><span>1.5M Followers</span></a>
    </body></html>
  `;

  const child = spawn("npm", ["run", "dev"], {
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      BROWSER_POOL_ENABLED: "false",
      STANDBY_ENABLED: "false",
      API_KEY_ENABLED: "true",
      API_KEY: apiKey,
    },
  });

  try {
    await waitForEndpoint(`${baseUrl}/v1/health`, 20_000);

    const healthResponse = await fetch(`${baseUrl}/v1/health`);
    const health = await healthResponse.json();
    assert(healthResponse.status === 200, "health status should be 200");
    assert(health.ok === true, "health payload ok should be true");
    assert(hasMeta(health), "health response should include meta.request_id");

    const unauthFetchResponse = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "x",
        operation: "profile",
        target: { handle: "openai", mockHtml: mockXHtml },
      }),
    });
    const unauthFetch = await unauthFetchResponse.json();
    assert(unauthFetchResponse.status === 401, "unauthenticated fetch should return 401");
    assert(unauthFetch.error?.code === "AUTH_REQUIRED", "missing auth should return AUTH_REQUIRED");
    assert(hasMeta(unauthFetch), "auth error response should include meta.request_id");

    const invalidFetchResponse = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        source: "x",
        target: { handle: "openai" },
      }),
    });
    const invalidFetch = await invalidFetchResponse.json();
    assert(invalidFetchResponse.status === 400, "invalid fetch should return 400");
    assert(
      invalidFetch.error?.code === "VALIDATION_ERROR",
      "schema validation should return VALIDATION_ERROR",
    );
    assert(hasMeta(invalidFetch), "validation error response should include meta.request_id");

    const okFetchResponse = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        source: "x",
        operation: "profile",
        target: { handle: "openai", mockHtml: mockXHtml },
        fields: ["display_name", "handle", "follower_count"],
        timeout_ms: 6000,
        fast_mode: true,
        cache_mode: "default",
      }),
    });
    const okFetch = await okFetchResponse.json();
    assert(okFetchResponse.status === 200, "valid fetch should return 200");
    assert(okFetch.ok === true, "valid fetch envelope ok should be true");
    assert(hasMeta(okFetch), "success response should include meta.request_id");

    const adaptersHealthResponse = await fetch(`${baseUrl}/v1/adapters/health`, {
      headers: { "x-api-key": apiKey },
    });
    const adaptersHealth = await adaptersHealthResponse.json();
    assert(adaptersHealthResponse.status === 200, "adapter health should return 200");
    assert(adaptersHealth.ok === true, "adapter health envelope ok should be true");

    const debugPerformanceResponse = await fetch(`${baseUrl}/v1/debug/performance`, {
      headers: { "x-api-key": apiKey },
    });
    const debugPerformance = await debugPerformanceResponse.json();
    assert(debugPerformanceResponse.status === 200, "debug performance should return 200");
    assert(debugPerformance.ok === true, "debug performance envelope ok should be true");

    const metricsResponse = await fetch(`${baseUrl}/v1/metrics`, {
      headers: { "x-api-key": apiKey },
    });
    const metricsText = await metricsResponse.text();
    assert(metricsResponse.status === 200, "metrics should return 200");
    assert(
      metricsText.includes("shadow_api_http_requests_total"),
      "metrics exposition should include shadow_api_http_requests_total",
    );

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          healthStatus: healthResponse.status,
          unauthFetchStatus: unauthFetchResponse.status,
          invalidFetchStatus: invalidFetchResponse.status,
          okFetchStatus: okFetchResponse.status,
          adaptersHealthStatus: adaptersHealthResponse.status,
          debugPerformanceStatus: debugPerformanceResponse.status,
          metricsStatus: metricsResponse.status,
        },
        null,
        2,
      ),
    );
  } finally {
    child.kill("SIGTERM");
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
