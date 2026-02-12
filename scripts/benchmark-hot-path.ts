import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

const quantile = (sorted: number[], ratio: number): number => {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * ratio;
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low];
  const weight = idx - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
};

const summarize = (durations: number[]) => {
  const sorted = [...durations].sort((a, b) => a - b);
  const avg = sorted.reduce((acc, entry) => acc + entry, 0) / Math.max(1, sorted.length);
  return {
    count: sorted.length,
    min_ms: sorted[0] ?? 0,
    max_ms: sorted[sorted.length - 1] ?? 0,
    avg_ms: Number(avg.toFixed(2)),
    p50_ms: Number(quantile(sorted, 0.5).toFixed(2)),
    p95_ms: Number(quantile(sorted, 0.95).toFixed(2)),
  };
};

const run = async (): Promise<void> => {
  const port = Number(process.env.PORT ?? 3600);
  const baseUrl = `http://127.0.0.1:${port}`;
  const warmup = Number(process.env.WARMUP_REQUESTS ?? 20);
  const samples = Number(process.env.BENCHMARK_REQUESTS ?? 120);
  const concurrency = Math.max(1, Number(process.env.BENCHMARK_CONCURRENCY ?? 8));
  const latencyTargetP50Ms = Number(process.env.P50_TARGET_MS ?? 2000);

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

  const payload = {
    source: "x",
    operation: "profile",
    target: { handle: "openai", mockHtml: mockXHtml, benchmarkTag: "m5-hot-path" },
    fields: ["display_name", "handle", "follower_count"],
    timeout_ms: 5000,
    fast_mode: true,
    cache_mode: "default",
  };

  const child = spawn("npm", ["run", "dev"], {
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      BROWSER_POOL_ENABLED: "false",
      STANDBY_ENABLED: "false",
      MOCK_FETCH_DELAY_MS: "0",
      CACHE_PROVIDER: "memory",
      CACHE_TTL_MS: "300000",
      CACHE_STALE_TTL_MS: "300000",
      CACHE_SWR_ENABLED: "true",
      FAST_MODE_ENABLED: "true",
      FAST_MODE_MAX_FIELDS: "3",
      PREWARM_ENABLED: "false",
    },
  });

  try {
    await waitForEndpoint(`${baseUrl}/v1/health`, 20_000);

    const runRequest = async (): Promise<number> => {
      const started = Date.now();
      const response = await fetch(`${baseUrl}/v1/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const elapsed = Date.now() - started;
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Benchmark request failed with ${response.status}: ${body}`);
      }
      return elapsed;
    };

    for (let i = 0; i < warmup; i += 1) {
      await runRequest();
    }

    const durations: number[] = [];
    let issued = 0;
    while (issued < samples) {
      const batch = Math.min(concurrency, samples - issued);
      const timings = await Promise.all(Array.from({ length: batch }, () => runRequest()));
      durations.push(...timings);
      issued += batch;
    }

    const stats = summarize(durations);
    const report = {
      generated_at: new Date().toISOString(),
      benchmark: "m5-hot-path",
      base_url: baseUrl,
      warmup_requests: warmup,
      benchmark_requests: samples,
      concurrency,
      target_p50_ms: latencyTargetP50Ms,
      stats,
    };

    const outDir = path.join(process.cwd(), "docs", "performance");
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, "hot-path-benchmark.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );

    if (stats.p50_ms > latencyTargetP50Ms) {
      throw new Error(
        `Benchmark failed: p50 ${stats.p50_ms}ms exceeds target ${latencyTargetP50Ms}ms`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } finally {
    child.kill("SIGTERM");
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
