import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createMeta, createSuccessEnvelope } from "./api/envelope";
import { createFetchRequestValidator } from "./api/schema-validation";
import type { FetchRequestInput } from "./extraction/types";
import {
  AuthInvalidError,
  AuthRequiredError,
  NotFoundError,
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
  isShuttingDown: () => boolean;
  onActivity: () => void;
  enqueueFetch: (request: FetchRequestInput) => Promise<unknown>;
}

const json = (res: ServerResponse, statusCode: number, body: unknown): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const sendError = (
  res: ServerResponse,
  requestId: string,
  error: unknown,
  metaExtras: Record<string, unknown> = {},
): void => {
  const appError = normalizeError(error);
  json(
    res,
    appError.statusCode,
    toErrorBody(appError, createMeta(requestId, metaExtras)),
  );
};

const readJsonBody = async (
  req: IncomingMessage,
  options: { maxBytes: number },
): Promise<unknown> => {
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
    throw new ValidationError("Request body is required.");
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw) as unknown;
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

const isPublicRoute = (method: string, path: string): boolean =>
  method === "GET" && (path === "/v1/health" || path === "/v1/ready");

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
  const validateFetchRequest = createFetchRequestValidator({
    minMs: runtime.fetchTimeoutMinMs,
    maxMs: runtime.fetchTimeoutMaxMs,
    defaultMs: runtime.fetchTimeoutDefaultMs,
  });

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
  ): Promise<void> => {
    const method = req.method ?? "GET";
    const parsedUrl = new URL(req.url ?? "/", "http://shadow-api.local");
    const path = parsedUrl.pathname;

    ensureAuthorized(runtime, req, path);

    if (method === "GET" && path === "/v1/health") {
      json(
        res,
        200,
        createSuccessEnvelope(requestId, {
          status: "ok",
          uptime_s: Math.floor((Date.now() - startedAt) / 1000),
          api_key_enabled: runtime.apiKeyEnabled,
        }),
      );
      return;
    }

    if (method === "GET" && path === "/v1/ready") {
      json(
        res,
        200,
        createSuccessEnvelope(requestId, {
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
        }),
      );
      return;
    }

    state.onActivity();

    if (method === "GET" && path === "/v1/debug/queue") {
      json(
        res,
        200,
        createSuccessEnvelope(requestId, {
          queue_depth: state.getQueueDepth(),
          queue_inflight: state.getQueueInflight(),
          shutting_down: state.isShuttingDown(),
        }),
      );
      return;
    }

    if (method === "GET" && path === "/v1/adapters/health") {
      json(
        res,
        200,
        createSuccessEnvelope(requestId, {
          adapters: state.getAdapterHealth(),
        }),
      );
      return;
    }

    if (method === "GET" && path === "/v1/debug/performance") {
      json(
        res,
        200,
        createSuccessEnvelope(requestId, {
          performance: state.getPerformanceReport(),
          queue_depth: state.getQueueDepth(),
          queue_inflight: state.getQueueInflight(),
        }),
      );
      return;
    }

    if (method === "POST" && path === "/v1/fetch") {
      if (state.isShuttingDown()) {
        throw new ShuttingDownError();
      }

      const payload = await readJsonBody(req, {
        maxBytes: runtime.requestBodyMaxBytes,
      });
      const fetchRequest = validateFetchRequest(payload);
      const result = await state.enqueueFetch(fetchRequest);

      json(
        res,
        200,
        createSuccessEnvelope(
          requestId,
          result,
          {
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
    void handle(req, res, requestId).catch((error: unknown) => {
      sendError(res, requestId, error, {
        path: req.url ?? "/",
        method: req.method ?? "GET",
      });
    });
  });
};
