import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { API_VERSION } from "./api/contracts";
import { createMeta, createSuccessEnvelope } from "./api/envelope";
import { createFetchRequestValidator } from "./api/schema-validation";
import type { FetchRequestInput } from "./extraction/types";
import { getRequestContext, runWithRequestContext } from "./observability/request-context";
import { MetricsRegistry, estimateFetchCostUnits, readPerformanceFields } from "./observability/metrics";
import { FixedWindowRateLimiter } from "./security/rate-limiter";
import { verifyRequestSignature } from "./security/request-signature";
import {
  AuthInvalidError,
  AuthRequiredError,
  NotFoundError,
  RateLimitedError,
  ShuttingDownError,
  ValidationError,
  normalizeError,
  toErrorBody,
} from "./runtime/errors";
import type { RuntimeConfig } from "./types";

export interface ServerRuntimeState {
  getQueueDepth: () => number;
  getQueueInflight: () => number;
  getWarmSessions: () => number;
  getStandbyMode: () => "disabled" | "active" | "standby";
  getStandbyIdleMs: () => number;
  getAdapterHealth: () => unknown;
  getPerformanceReport: () => unknown;
  getReliabilityReport: () => unknown;
  purgeData: () => Promise<unknown>;
  isShuttingDown: () => boolean;
  onActivity: () => void;
  enqueueFetch: (request: FetchRequestInput) => Promise<unknown>;
}

const json = (res: ServerResponse, statusCode: number, body: unknown): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const text = (res: ServerResponse, statusCode: number, body: string): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
  res.end(body);
};

const sendError = (
  metrics: MetricsRegistry,
  res: ServerResponse,
  requestId: string,
  error: unknown,
  metaExtras: Record<string, unknown> = {},
): void => {
  const appError = normalizeError(error);
  res.setHeader("x-shadow-error-code", appError.code);
  if (appError.code === "RATE_LIMITED") {
    const retryAfterMs = appError.details?.retry_after_ms;
    if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      res.setHeader("retry-after", String(Math.ceil(retryAfterMs / 1000)));
    }
  }

  const ctx = getRequestContext();
  if (ctx) {
    metrics.inc("shadow_api_http_errors_total", {
      method: ctx.http_method,
      path: ctx.http_path,
      code: appError.code,
    });
    if (ctx.source && ctx.operation) {
      metrics.inc("shadow_api_fetch_errors_total", {
        source: ctx.source,
        operation: ctx.operation,
        code: appError.code,
      });
    }
  }

  json(
    res,
    appError.statusCode,
    toErrorBody(appError, createMeta(requestId, metaExtras)),
  );
};

const readRawBody = async (
  req: IncomingMessage,
  options: { maxBytes: number; required?: boolean },
): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBytes) {
        reject(
          new ValidationError("Request body exceeds max size.", {
            maxBytes: options.maxBytes,
          }),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });

  if (chunks.length === 0) {
    if (options.required === false) return "";
    throw new ValidationError("Request body is required.");
  }

  return Buffer.concat(chunks).toString("utf8");
};

const readJsonBody = async (
  req: IncomingMessage,
  options: { maxBytes: number; required?: boolean },
): Promise<{ raw: string; parsed: unknown }> => {
  const raw = await readRawBody(req, options);
  if (!raw && options.required === false) {
    return { raw, parsed: null };
  }

  try {
    return { raw, parsed: JSON.parse(raw) as unknown };
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
};

const extractClientApiKey = (req: IncomingMessage): string | null => {
  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim().length > 0) {
    return xApiKey.trim();
  }

  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }

  return null;
};

const toClientKeyId = (apiKey: string): string =>
  createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 12);

const extractTraceId = (req: IncomingMessage): string => {
  const value = req.headers["x-shadow-trace-id"];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 128);
  }
  return `trace_${randomUUID()}`;
};

const isPublicRoute = (method: string, path: string): boolean =>
  method === "GET" && (path === "/v1/health" || path === "/v1/ready");

const extractClientIp = (req: IncomingMessage): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
};

const ensureAuthorized = (runtime: RuntimeConfig, req: IncomingMessage, path: string): void => {
  if (!runtime.apiKeyEnabled) return;
  if (isPublicRoute(req.method ?? "GET", path)) return;

  const expected = runtime.apiKey;
  if (!expected) {
    throw new AuthRequiredError({
      reason: "API key auth is enabled but API key is not configured.",
    });
  }

  const provided = extractClientApiKey(req);
  if (!provided) {
    throw new AuthRequiredError({
      acceptedHeaders: ["x-api-key", "Authorization: Bearer <key>"],
    });
  }
  if (provided !== expected) {
    throw new AuthInvalidError({
      acceptedHeaders: ["x-api-key", "Authorization: Bearer <key>"],
    });
  }
};

const notFound = (req: IncomingMessage): NotFoundError =>
  new NotFoundError(`Route not found: ${req.method ?? "GET"} ${req.url ?? "/"}`, {
    path: req.url ?? "/",
    method: req.method ?? "GET",
  });

export const createApiServer = (runtime: RuntimeConfig, state: ServerRuntimeState): Server => {
  const startedAt = Date.now();
  const metrics = new MetricsRegistry();
  const signing = {
    enabled: runtime.hmacSigningEnabled,
    secrets: runtime.hmacSecrets,
    maxSkewSec: runtime.hmacMaxSkewSec,
    signatureHeader: runtime.hmacSignatureHeader,
    timestampHeader: runtime.hmacTimestampHeader,
  };

  const globalLimiter = runtime.rateLimitEnabled
    ? new FixedWindowRateLimiter({
        windowMs: runtime.rateLimitWindowMs,
        limit: runtime.rateLimitGlobalMax,
      })
    : null;
  const ipLimiter = runtime.rateLimitEnabled
    ? new FixedWindowRateLimiter({
        windowMs: runtime.rateLimitWindowMs,
        limit: runtime.rateLimitIpMax,
      })
    : null;
  const apiKeyLimiter = runtime.rateLimitEnabled
    ? new FixedWindowRateLimiter({
        windowMs: runtime.rateLimitWindowMs,
        limit: runtime.rateLimitApiKeyMax,
      })
    : null;

  const validateFetchRequest = createFetchRequestValidator({
    minMs: runtime.fetchTimeoutMinMs,
    maxMs: runtime.fetchTimeoutMaxMs,
    defaultMs: runtime.fetchTimeoutDefaultMs,
  });

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    traceId: string,
  ): Promise<void> => {
    const method = req.method ?? "GET";
    const parsedUrl = new URL(req.url ?? "/", "http://shadow-api.local");
    const path = parsedUrl.pathname;
    const pathWithQuery = `${parsedUrl.pathname}${parsedUrl.search}`;

    ensureAuthorized(runtime, req, path);

    if (method === "GET" && path === "/v1/health") {
      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          {
            status: "ok",
            uptime_s: Math.floor((Date.now() - startedAt) / 1000),
            api_key_enabled: runtime.apiKeyEnabled,
          },
          { trace_id: traceId },
        ),
      );
      return;
    }

    if (method === "GET" && path === "/v1/ready") {
      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          {
            ready: !state.isShuttingDown(),
            queue_depth: state.getQueueDepth(),
            queue_inflight: state.getQueueInflight(),
            warm_sessions: state.getWarmSessions(),
            standby_mode: state.getStandbyMode(),
            standby_idle_ms: state.getStandbyIdleMs(),
            shutting_down: state.isShuttingDown(),
            host: runtime.host,
            port: runtime.port,
            timeout_policy: {
              fetch_default_ms: runtime.fetchTimeoutDefaultMs,
              fetch_min_ms: runtime.fetchTimeoutMinMs,
              fetch_max_ms: runtime.fetchTimeoutMaxMs,
            },
            cache_policy: {
              provider: runtime.cacheProvider,
              ttl_ms: runtime.cacheTtlMs,
              stale_ttl_ms: runtime.cacheStaleTtlMs,
              swr_enabled: runtime.cacheSwrEnabled,
            },
            fast_mode_enabled: runtime.fastModeEnabled,
            prewarm_enabled: runtime.prewarmEnabled,
          },
          { trace_id: traceId },
        ),
      );
      return;
    }

    if (signing.enabled && method !== "POST" && !isPublicRoute(method, path)) {
      verifyRequestSignature(signing, req, pathWithQuery, "");
    }

    if (runtime.rateLimitEnabled && !isPublicRoute(method, path)) {
      const ip = extractClientIp(req);
      const apiKey = extractClientApiKey(req);

      const globalDecision = globalLimiter?.check("global");
      if (globalDecision && !globalDecision.allowed) {
        throw new RateLimitedError({
          scope: "global",
          retry_after_ms: globalDecision.retryAfterMs,
          window_ms: globalDecision.windowMs,
          limit: globalDecision.limit,
        });
      }

      const ipDecision = ipLimiter?.check(`ip:${ip}`);
      if (ipDecision && !ipDecision.allowed) {
        throw new RateLimitedError({
          scope: "ip",
          ip,
          retry_after_ms: ipDecision.retryAfterMs,
          window_ms: ipDecision.windowMs,
          limit: ipDecision.limit,
        });
      }

      if (apiKey) {
        const apiKeyDecision = apiKeyLimiter?.check(`api_key:${apiKey}`);
        if (apiKeyDecision && !apiKeyDecision.allowed) {
          throw new RateLimitedError({
            scope: "api_key",
            retry_after_ms: apiKeyDecision.retryAfterMs,
            window_ms: apiKeyDecision.windowMs,
            limit: apiKeyDecision.limit,
          });
        }
      }
    }

    if (method === "GET" && path === "/v1/metrics") {
      const performance = state.getPerformanceReport();
      const reliability = state.getReliabilityReport();

      const queueDepth = state.getQueueDepth();
      const queueInflight = state.getQueueInflight();
      const warmSessions = state.getWarmSessions();
      const standbyMode = state.getStandbyMode();
      const standbyCode = standbyMode === "disabled" ? 0 : standbyMode === "active" ? 1 : 2;

      const extra: string[] = [];
      extra.push(`shadow_api_build_info{version="${API_VERSION}"} 1`);
      extra.push(`shadow_api_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`);
      extra.push(`shadow_api_queue_depth ${queueDepth}`);
      extra.push(`shadow_api_queue_inflight ${queueInflight}`);
      extra.push(`shadow_api_warm_sessions ${warmSessions}`);
      extra.push(`shadow_api_standby_mode ${standbyCode}`);

      if (typeof performance === "object" && performance !== null) {
        const pipeline = (performance as Record<string, unknown>).pipeline;
        const cache = pipeline && typeof pipeline === "object" && pipeline !== null
          ? (pipeline as Record<string, unknown>).cache
          : null;
        if (cache && typeof cache === "object" && cache !== null) {
          for (const key of ["lookups", "hits", "misses", "fresh_hits", "stale_hits", "writes", "evictions"]) {
            const value = (cache as Record<string, unknown>)[key];
            if (typeof value === "number" && Number.isFinite(value)) {
              extra.push(`shadow_api_cache_${key}_total ${value}`);
            }
          }
        }
      }

      if (typeof reliability === "object" && reliability !== null) {
        const circuits = (reliability as Record<string, unknown>).circuits;
        if (Array.isArray(circuits)) {
          const open = circuits.filter((entry) => (entry as Record<string, unknown>).state === "open").length;
          const halfOpen = circuits.filter((entry) => (entry as Record<string, unknown>).state === "half_open").length;
          extra.push(`shadow_api_circuits_open ${open}`);
          extra.push(`shadow_api_circuits_half_open ${halfOpen}`);
        }
        const deadLetters = (reliability as Record<string, unknown>).dead_letters;
        if (deadLetters && typeof deadLetters === "object" && deadLetters !== null) {
          const total = (deadLetters as Record<string, unknown>).total;
          if (typeof total === "number" && Number.isFinite(total)) {
            extra.push(`shadow_api_dead_letters_total ${total}`);
          }
        }
        const incidents = (reliability as Record<string, unknown>).incidents;
        if (incidents && typeof incidents === "object" && incidents !== null) {
          const total = (incidents as Record<string, unknown>).total_events;
          if (typeof total === "number" && Number.isFinite(total)) {
            extra.push(`shadow_api_incidents_total ${total}`);
          }
        }
      }

      text(res, 200, metrics.renderPrometheus(extra));
      return;
    }

    if (method === "GET" && path === "/v1/admin/diagnostics") {
      if (!runtime.apiKeyEnabled) {
        throw notFound(req);
      }

      const memory = process.memoryUsage();
      const data = {
        system: {
          node_version: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          uptime_s: Math.floor(process.uptime()),
          memory_rss_bytes: memory.rss,
          memory_heap_used_bytes: memory.heapUsed,
          memory_heap_total_bytes: memory.heapTotal,
        },
        runtime: {
          host: runtime.host,
          port: runtime.port,
          log_level: runtime.logLevel,
          api_key_enabled: runtime.apiKeyEnabled,
          hmac_signing_enabled: runtime.hmacSigningEnabled,
          rate_limit_enabled: runtime.rateLimitEnabled,
          cache_provider: runtime.cacheProvider,
          cache_ttl_ms: runtime.cacheTtlMs,
          cache_stale_ttl_ms: runtime.cacheStaleTtlMs,
          cache_swr_enabled: runtime.cacheSwrEnabled,
          standby_enabled: runtime.standbyEnabled,
          browser_pool_enabled: runtime.browserPoolEnabled,
          browser_pool_size: runtime.browserPoolSize,
          proxy_rotation_enabled: runtime.proxyRotationEnabled,
          fingerprint_rotation_enabled: runtime.fingerprintRotationEnabled,
          retry_max_attempts: runtime.retryMaxAttempts,
          circuit_breaker_enabled: runtime.circuitBreakerEnabled,
          dead_letter_enabled: runtime.deadLetterEnabled,
        },
        queue: {
          depth: state.getQueueDepth(),
          inflight: state.getQueueInflight(),
        },
        standby: {
          mode: state.getStandbyMode(),
          idle_ms: state.getStandbyIdleMs(),
        },
        warm_sessions: state.getWarmSessions(),
        adapters: state.getAdapterHealth(),
        performance: state.getPerformanceReport(),
        reliability: state.getReliabilityReport(),
      };

      json(res, 200, createSuccessEnvelope(requestId, data, { trace_id: traceId }));
      return;
    }

    state.onActivity();

    if (method === "GET" && path === "/v1/debug/queue") {
      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          {
            queue_depth: state.getQueueDepth(),
            queue_inflight: state.getQueueInflight(),
            shutting_down: state.isShuttingDown(),
          },
          { trace_id: traceId },
        ),
      );
      return;
    }

    if (method === "POST" && path === "/v1/admin/purge") {
      if (!runtime.apiKeyEnabled) {
        throw notFound(req);
      }
      if (state.isShuttingDown()) {
        throw new ShuttingDownError();
      }

      const body = await readRawBody(req, {
        maxBytes: runtime.requestBodyMaxBytes,
        required: false,
      });
      if (signing.enabled) {
        verifyRequestSignature(signing, req, pathWithQuery, body);
      }

      const purged = await state.purgeData();
      json(
        res,
        200,
        createSuccessEnvelope(requestId, { purged }, { trace_id: traceId }),
      );
      return;
    }

    if (method === "GET" && path === "/v1/adapters/health") {
      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          {
            adapters: state.getAdapterHealth(),
          },
          { trace_id: traceId },
        ),
      );
      return;
    }

    if (method === "GET" && path === "/v1/debug/performance") {
      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          {
            performance: state.getPerformanceReport(),
            queue_depth: state.getQueueDepth(),
            queue_inflight: state.getQueueInflight(),
          },
          { trace_id: traceId },
        ),
      );
      return;
    }

    if (method === "GET" && path === "/v1/debug/reliability") {
      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          {
            reliability: state.getReliabilityReport(),
            queue_depth: state.getQueueDepth(),
            queue_inflight: state.getQueueInflight(),
          },
          { trace_id: traceId },
        ),
      );
      return;
    }

    if (method === "POST" && path === "/v1/fetch") {
      if (state.isShuttingDown()) {
        throw new ShuttingDownError();
      }

      const body = await readJsonBody(req, {
        maxBytes: runtime.requestBodyMaxBytes,
      });
      if (signing.enabled) {
        verifyRequestSignature(signing, req, pathWithQuery, body.raw);
      }

      const fetchRequest = validateFetchRequest(body.parsed);
      const ctx = getRequestContext();
      const normalizedSource = fetchRequest.source.trim().toLowerCase();
      const normalizedOperation = fetchRequest.operation.trim().toLowerCase();
      if (ctx) {
        ctx.source = normalizedSource;
        ctx.operation = normalizedOperation;
      }

      const result = await state.enqueueFetch(fetchRequest);

      const perf = readPerformanceFields(result);
      const costUnits = estimateFetchCostUnits({
        cache_hit: perf.cache_hit,
        retry_attempt: perf.retry_attempt,
        fast_mode: fetchRequest.fast_mode === true,
      });
      metrics.inc("shadow_api_fetch_requests_total", {
        source: normalizedSource,
        operation: normalizedOperation,
      });
      metrics.inc(
        "shadow_api_fetch_cost_units_total",
        {
          source: normalizedSource,
          operation: normalizedOperation,
        },
        costUnits,
      );

      if (typeof (result as Record<string, unknown>)?.latency_ms === "number") {
        metrics.observeMs(
          "shadow_api_fetch_latency_ms",
          { source: normalizedSource, operation: normalizedOperation },
          (result as Record<string, unknown>).latency_ms as number,
        );
      }

      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          result,
          {
            trace_id: traceId,
            queue_depth: state.getQueueDepth(),
            queue_inflight: state.getQueueInflight(),
            timeout_ms: fetchRequest.timeout_ms,
          },
        ),
      );
      return;
    }

    throw notFound(req);
  };

  return createServer((req, res) => {
    const requestId = `req_${randomUUID()}`;
    const traceId = extractTraceId(req);
    res.setHeader("x-shadow-request-id", requestId);
    res.setHeader("x-shadow-trace-id", traceId);

    const startedAtMs = Date.now();
    const parsedUrl = new URL(req.url ?? "/", "http://shadow-api.local");
    const path = parsedUrl.pathname;
    const method = req.method ?? "GET";
    const apiKey = extractClientApiKey(req);

    res.on("finish", () => {
      metrics.inc("shadow_api_http_requests_total", {
        method,
        path,
        status: res.statusCode,
      });
      metrics.observeMs("shadow_api_http_request_duration_ms", { method, path }, Date.now() - startedAtMs);
    });

    runWithRequestContext(
      {
        request_id: requestId,
        trace_id: traceId,
        http_method: method,
        http_path: path,
        client_ip: extractClientIp(req),
        client_key_present: Boolean(apiKey),
        client_key_id: apiKey ? toClientKeyId(apiKey) : null,
        source: null,
        operation: null,
        started_at_ms: Date.now(),
      },
      () => {
        void handle(req, res, requestId, traceId).catch((error: unknown) => {
          sendError(metrics, res, requestId, error, {
            trace_id: traceId,
            path: req.url ?? "/",
            method: req.method ?? "GET",
          });
        });
      },
    );
  });
};
