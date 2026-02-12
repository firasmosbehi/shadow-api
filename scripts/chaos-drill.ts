import { spawn } from "node:child_process";

interface ChaosConfig {
  scenario: "timeout" | "network" | "proxy";
  fail_attempts: number;
}

interface Scenario {
  name: string;
  chaos: ChaosConfig;
  expectedOk: boolean;
  minRetryAttempt?: number;
  expectedErrorCode?: string;
  expectDeadLetterIncrease?: boolean;
}

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

const buildDataUrl = (): string => {
  const mockXHtml = `
    <html><body>
      <div data-testid="UserName"><span>OpenAI</span><span>@OpenAI</span></div>
      <div data-testid="UserDescription">Building safe AGI.</div>
      <div data-testid="UserLocation">San Francisco, CA</div>
      <a href="/openai/followers"><span>1.5M Followers</span></a>
      <a href="/openai/following"><span>42 Following</span></a>
      <a href="/openai/with_replies"><span>9,876 Posts</span></a>
    </body></html>
  `;
  return `data:text/html,${encodeURIComponent(mockXHtml)}`;
};

const fetchJson = async (
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Expected JSON from ${url}. Status ${response.status}, body: ${text}`);
  }
  return { status: response.status, body };
};

const readDeadLetterTotal = (payload: Record<string, unknown>): number => {
  const data = payload.data as Record<string, unknown> | undefined;
  const reliability = data?.reliability as Record<string, unknown> | undefined;
  const deadLetters = reliability?.dead_letters as Record<string, unknown> | undefined;
  const total = deadLetters?.total;
  return typeof total === "number" ? total : 0;
};

const runScenario = async (
  baseUrl: string,
  scenario: Scenario,
  dataUrl: string,
): Promise<Record<string, unknown>> => {
  const beforeReliability = await fetchJson(`${baseUrl}/v1/debug/reliability`);
  const dlqBefore = readDeadLetterTotal(beforeReliability.body);

  const payload = {
    source: "x",
    operation: "profile",
    target: {
      url: dataUrl,
      chaos: scenario.chaos,
    },
    fields: ["display_name", "handle", "follower_count"],
    timeout_ms: 3500,
    cache_mode: "bypass",
    fast_mode: false,
  };

  const response = await fetchJson(`${baseUrl}/v1/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const ok = response.status >= 200 && response.status < 300;
  if (scenario.expectedOk && !ok) {
    throw new Error(
      `${scenario.name} expected success but failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  if (!scenario.expectedOk && ok) {
    throw new Error(`${scenario.name} expected failure but succeeded.`);
  }

  let retryAttempt: number | null = null;
  if (ok) {
    const data = response.body.data as Record<string, unknown> | undefined;
    const performance = data?.performance as Record<string, unknown> | undefined;
    const rawRetryAttempt = performance?.retry_attempt;
    retryAttempt = typeof rawRetryAttempt === "number" ? rawRetryAttempt : null;
    if (scenario.minRetryAttempt && (retryAttempt ?? 0) < scenario.minRetryAttempt) {
      throw new Error(
        `${scenario.name} expected retry attempt >= ${scenario.minRetryAttempt}, received ${retryAttempt ?? "null"}.`,
      );
    }
  } else if (scenario.expectedErrorCode) {
    const error = response.body.error as Record<string, unknown> | undefined;
    const code = error?.code;
    if (code !== scenario.expectedErrorCode) {
      throw new Error(
        `${scenario.name} expected error code ${scenario.expectedErrorCode}, received ${String(code)}.`,
      );
    }
  }

  const afterReliability = await fetchJson(`${baseUrl}/v1/debug/reliability`);
  const dlqAfter = readDeadLetterTotal(afterReliability.body);
  if (scenario.expectDeadLetterIncrease && dlqAfter <= dlqBefore) {
    throw new Error(
      `${scenario.name} expected dead-letter increase (before=${dlqBefore}, after=${dlqAfter}).`,
    );
  }

  return {
    scenario: scenario.name,
    status: response.status,
    retry_attempt: retryAttempt,
    dead_letters_before: dlqBefore,
    dead_letters_after: dlqAfter,
  };
};

const run = async (): Promise<void> => {
  const port = Number(process.env.PORT ?? 3610);
  const baseUrl = process.env.SHADOW_API_BASE_URL ?? `http://127.0.0.1:${port}`;
  const autoStart = process.env.CHAOS_AUTO_START !== "false";
  const dataUrl = buildDataUrl();
  const dlqStore = `SHADOW_API_DLQ_CHAOS_${Date.now()}`;

  let child: ReturnType<typeof spawn> | null = null;
  if (autoStart) {
    child = spawn("npm", ["run", "dev"], {
      stdio: "ignore",
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        BROWSER_POOL_ENABLED: "false",
        STANDBY_ENABLED: "false",
        MOCK_FETCH_DELAY_MS: "0",
        CACHE_PROVIDER: "memory",
        CACHE_TTL_MS: "60000",
        CACHE_STALE_TTL_MS: "60000",
        CACHE_SWR_ENABLED: "false",
        PREWARM_ENABLED: "false",
        RETRY_MAX_ATTEMPTS: "3",
        RETRY_BASE_DELAY_MS: "50",
        RETRY_MAX_DELAY_MS: "300",
        RETRY_BLOCKED_DELAY_MS: "120",
        RETRY_JITTER_MS: "10",
        DEAD_LETTER_ENABLED: "true",
        DEAD_LETTER_STORE_NAME: dlqStore,
        DEAD_LETTER_MAX_ENTRIES: "100",
      },
    });
    await waitForEndpoint(`${baseUrl}/v1/health`, 20_000);
  }

  try {
    const scenarios: Scenario[] = [
      {
        name: "network-recovery",
        chaos: { scenario: "network", fail_attempts: 2 },
        expectedOk: true,
        minRetryAttempt: 3,
      },
      {
        name: "timeout-recovery",
        chaos: { scenario: "timeout", fail_attempts: 1 },
        expectedOk: true,
        minRetryAttempt: 2,
      },
      {
        name: "network-terminal-failure",
        chaos: { scenario: "network", fail_attempts: 6 },
        expectedOk: false,
        expectedErrorCode: "INTERNAL_ERROR",
        expectDeadLetterIncrease: true,
      },
    ];

    const results: Record<string, unknown>[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(baseUrl, scenario, dataUrl));
    }

    const reliability = await fetchJson(`${baseUrl}/v1/debug/reliability`);
    const report = {
      generated_at: new Date().toISOString(),
      base_url: baseUrl,
      scenarios: results,
      reliability_snapshot: reliability.body.data,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (child) child.kill("SIGTERM");
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
