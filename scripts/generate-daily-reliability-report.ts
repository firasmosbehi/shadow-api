import { createHash, createHmac } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Actor } from "apify";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const hmacSha256Hex = (secret: string, value: string): string =>
  createHmac("sha256", secret).update(value, "utf8").digest("hex");

const sign = (params: {
  secret: string;
  method: string;
  pathWithQuery: string;
  rawBody: string;
  timestampSec: number;
}): { signature: string; timestamp: string } => {
  const canonical = `${params.timestampSec}.${params.method.toUpperCase()}.${params.pathWithQuery}.${sha256Hex(params.rawBody)}`;
  return {
    signature: hmacSha256Hex(params.secret, canonical),
    timestamp: String(params.timestampSec),
  };
};

const fetchJson = async (url: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 200)}`);
  }
};

const fetchText = async (url: string, init?: RequestInit): Promise<string> => {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${text}`);
  }
  return text;
};

const buildHeaders = (params: {
  apiKey: string | null;
  hmacSecret: string | null;
  signatureHeader: string;
  timestampHeader: string;
  method: string;
  pathWithQuery: string;
  rawBody: string;
}): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (params.apiKey) headers["x-api-key"] = params.apiKey;
  if (params.hmacSecret) {
    const ts = Math.floor(Date.now() / 1000);
    const signed = sign({
      secret: params.hmacSecret,
      method: params.method,
      pathWithQuery: params.pathWithQuery,
      rawBody: params.rawBody,
      timestampSec: ts,
    });
    headers[params.signatureHeader] = signed.signature;
    headers[params.timestampHeader] = signed.timestamp;
  }
  return headers;
};

const dateKey = (): string => new Date().toISOString().slice(0, 10);

const run = async (): Promise<void> => {
  const baseUrl = process.env.SHADOW_API_BASE_URL ?? "http://127.0.0.1:3000";
  const apiKey = process.env.SHADOW_API_API_KEY?.trim() || null;
  const hmacSecret = process.env.SHADOW_API_HMAC_SECRET?.trim() || null;
  const signatureHeader = process.env.SHADOW_API_HMAC_SIGNATURE_HEADER ?? "x-shadow-signature";
  const timestampHeader = process.env.SHADOW_API_HMAC_TIMESTAMP_HEADER ?? "x-shadow-timestamp";

  const storeName = process.env.REPORT_STORE_NAME ?? "SHADOW_API_REPORTS";
  const writeToKv = process.env.REPORT_WRITE_TO_KV !== "false";
  const outPath = process.env.REPORT_OUT_PATH ?? "";

  const endpoints = [
    { key: "ready", path: "/v1/ready", json: true },
    { key: "adapters_health", path: "/v1/adapters/health", json: true },
    { key: "performance", path: "/v1/debug/performance", json: true },
    { key: "reliability", path: "/v1/debug/reliability", json: true },
    { key: "metrics", path: "/v1/metrics", json: false },
  ] as const;

  const snapshots: Record<string, unknown> = {};
  for (const endpoint of endpoints) {
    const headers = buildHeaders({
      apiKey,
      hmacSecret,
      signatureHeader,
      timestampHeader,
      method: "GET",
      pathWithQuery: endpoint.path,
      rawBody: "",
    });
    const url = `${baseUrl}${endpoint.path}`;
    snapshots[endpoint.key] = endpoint.json
      ? await fetchJson(url, { headers })
      : await fetchText(url, { headers });
  }

  const report = {
    generated_at: new Date().toISOString(),
    date: dateKey(),
    base_url: baseUrl,
    snapshots,
  };

  if (outPath) {
    const abs = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (writeToKv) {
    await Actor.init();
    try {
      const store = await Actor.openKeyValueStore(storeName);
      const key = `daily-report-${report.date}`;
      await store.setValue(key, report);
    } finally {
      await Actor.exit();
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

