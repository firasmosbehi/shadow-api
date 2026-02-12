import { createHash, createHmac } from "node:crypto";
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
  if (!condition) throw new Error(message);
};

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

const run = async (): Promise<void> => {
  const port = 3410;
  const baseUrl = `http://127.0.0.1:${port}`;

  const apiKey = "local-test-key";
  const hmacSecret = "local-hmac-secret";
  const signatureHeader = "x-shadow-signature";
  const timestampHeader = "x-shadow-timestamp";

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
      HMAC_SIGNING_ENABLED: "true",
      HMAC_SECRETS: hmacSecret,
      HMAC_SIGNATURE_HEADER: signatureHeader,
      HMAC_TIMESTAMP_HEADER: timestampHeader,
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_WINDOW_MS: "5000",
      RATE_LIMIT_GLOBAL_MAX: "8",
      RATE_LIMIT_IP_MAX: "8",
      RATE_LIMIT_API_KEY_MAX: "8",
      DEAD_LETTER_ENABLED: "true",
      DEAD_LETTER_STORE_NAME: `SHADOW_API_DLQ_VERIFY_${Date.now()}`,
      DEAD_LETTER_MAX_ENTRIES: "100",
    },
  });

  try {
    await waitForEndpoint(`${baseUrl}/v1/health`, 20_000);

    const mockXHtml = `
      <html><body>
        <div data-testid="UserName"><span>OpenAI</span><span>@OpenAI</span></div>
        <a href="/openai/followers"><span>1.5M Followers</span></a>
      </body></html>
    `;
    const fetchPayload = {
      source: "x",
      operation: "profile",
      target: { handle: "openai", mockHtml: mockXHtml },
      fields: ["display_name", "handle", "follower_count"],
      timeout_ms: 6000,
      fast_mode: true,
      cache_mode: "bypass",
    };
    const rawBody = JSON.stringify(fetchPayload);

    const missingSigResp = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: rawBody,
    });
    const missingSig = await missingSigResp.json();
    assert(missingSigResp.status === 401, "missing signature should return 401");
    assert(missingSig.error?.code === "SIGNATURE_REQUIRED", "missing signature should return SIGNATURE_REQUIRED");

    const ts = Math.floor(Date.now() / 1000);
    const badSigResp = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        [signatureHeader]: "deadbeef",
        [timestampHeader]: String(ts),
      },
      body: rawBody,
    });
    const badSig = await badSigResp.json();
    assert(badSigResp.status === 401, "invalid signature should return 401");
    assert(badSig.error?.code === "SIGNATURE_INVALID", "invalid signature should return SIGNATURE_INVALID");

    const signed = sign({
      secret: hmacSecret,
      method: "POST",
      pathWithQuery: "/v1/fetch",
      rawBody,
      timestampSec: ts,
    });
    const okResp = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        [signatureHeader]: signed.signature,
        [timestampHeader]: signed.timestamp,
      },
      body: rawBody,
    });
    const ok = await okResp.json();
    assert(okResp.status === 200, "valid signature should allow request");
    assert(ok.ok === true, "valid signature response ok should be true");

    const purgeTs = Math.floor(Date.now() / 1000);
    const purgeSig = sign({
      secret: hmacSecret,
      method: "POST",
      pathWithQuery: "/v1/admin/purge",
      rawBody: "",
      timestampSec: purgeTs,
    });
    const purgeResp = await fetch(`${baseUrl}/v1/admin/purge`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        [signatureHeader]: purgeSig.signature,
        [timestampHeader]: purgeSig.timestamp,
      },
    });
    const purged = await purgeResp.json();
    assert(purgeResp.status === 200, "purge endpoint should return 200");
    assert(purged.ok === true, "purge response ok should be true");

    // Rate limit test: burst requests should eventually 429.
    const getTs = Math.floor(Date.now() / 1000);
    const getSig = sign({
      secret: hmacSecret,
      method: "GET",
      pathWithQuery: "/v1/debug/performance",
      rawBody: "",
      timestampSec: getTs,
    });

    let sawRateLimit = false;
    for (let i = 0; i < 30; i += 1) {
      // Recompute timestamp frequently to avoid skew failures.
      const loopTs = Math.floor(Date.now() / 1000);
      const loopSig = sign({
        secret: hmacSecret,
        method: "GET",
        pathWithQuery: "/v1/debug/performance",
        rawBody: "",
        timestampSec: loopTs,
      });

      const resp = await fetch(`${baseUrl}/v1/debug/performance`, {
        headers: {
          "x-api-key": apiKey,
          [signatureHeader]: loopSig.signature,
          [timestampHeader]: loopSig.timestamp,
        },
      });
      if (resp.status === 429) {
        const payload = await resp.json();
        assert(payload.error?.code === "RATE_LIMITED", "rate limited response should be RATE_LIMITED");
        sawRateLimit = true;
        break;
      }
    }
    assert(sawRateLimit, "expected at least one 429 RATE_LIMITED response");

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          missingSignatureStatus: missingSigResp.status,
          badSignatureStatus: badSigResp.status,
          okFetchStatus: okResp.status,
          purgeStatus: purgeResp.status,
          sawRateLimit,
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

