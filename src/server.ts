import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "./types";
import type { FetchRequestInput } from "./extraction/types";
import {
  NotFoundError,
  ShuttingDownError,
  ValidationError,
  normalizeError,
  toErrorBody,
} from "./runtime/errors";

export interface ServerRuntimeState {
  getQueueDepth: () => number;
  getQueueInflight: () => number;
  getWarmSessions: () => number;
  getStandbyMode: () => "disabled" | "active" | "standby";
  getStandbyIdleMs: () => number;
  getAdapterHealth: () => unknown;
  isShuttingDown: () => boolean;
  onActivity: () => void;
  enqueueFetch: (request: FetchRequestInput) => Promise<unknown>;
}

const json = (res: ServerResponse, statusCode: number, body: unknown): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const sendError = (res: ServerResponse, error: unknown): void => {
  const appError = normalizeError(error);
  json(res, appError.statusCode, toErrorBody(appError));
};

const readJsonBody = async (
  req: IncomingMessage,
  options: { maxBytes?: number } = {},
): Promise<unknown> => {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const chunks: Buffer[] = [];
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ValidationError("Request body exceeds max size.", { maxBytes }));
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

const validateFetchRequest = (payload: unknown): FetchRequestInput => {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("Fetch request payload must be a JSON object.");
  }

  const body = payload as Record<string, unknown>;
  const source = typeof body.source === "string" ? body.source.trim() : "";
  const operation = typeof body.operation === "string" ? body.operation.trim() : "";
  const target =
    body.target && typeof body.target === "object" ? (body.target as Record<string, unknown>) : null;

  if (!source) {
    throw new ValidationError("`source` is required and must be a non-empty string.");
  }
  if (!operation) {
    throw new ValidationError("`operation` is required and must be a non-empty string.");
  }
  if (!target) {
    throw new ValidationError("`target` is required and must be an object.");
  }

  const fields =
    Array.isArray(body.fields) && body.fields.every((entry) => typeof entry === "string")
      ? (body.fields as string[])
      : undefined;
  const freshness = typeof body.freshness === "string" ? body.freshness : undefined;
  const timeout_ms = typeof body.timeout_ms === "number" ? body.timeout_ms : undefined;

  return { source, operation, target, fields, freshness, timeout_ms };
};

const notFound = (req: IncomingMessage, res: ServerResponse): void =>
  sendError(
    res,
    new NotFoundError(`Route not found: ${req.method ?? "GET"} ${req.url ?? "/"}`, {
      path: req.url ?? "/",
      method: req.method ?? "GET",
    }),
  );

export const createApiServer = (runtime: RuntimeConfig, state: ServerRuntimeState): Server => {
  const startedAt = new Date();

  return createServer((req, res) => {
    const requestId = `req_${randomUUID()}`;
    const method = req.method ?? "GET";
    const path = req.url ?? "/";

    if (method === "GET" && path === "/v1/health") {
      json(res, 200, {
        ok: true,
        data: {
          status: "ok",
          uptime_s: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        },
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          version: "0.1.0",
        },
      });
      return;
    }

    if (method === "GET" && path === "/v1/ready") {
      json(res, 200, {
        ok: true,
        data: {
          ready: !state.isShuttingDown(),
          queue_depth: state.getQueueDepth(),
          queue_inflight: state.getQueueInflight(),
          warm_sessions: state.getWarmSessions(),
          standby_mode: state.getStandbyMode(),
          standby_idle_ms: state.getStandbyIdleMs(),
          shutting_down: state.isShuttingDown(),
          host: runtime.host,
          port: runtime.port,
        },
        error: null,
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "0.1.0",
        },
      });
      return;
    }

  if (method === "GET" && path === "/v1/debug/queue") {
    json(res, 200, {
      ok: true,
      data: {
          queue_depth: state.getQueueDepth(),
          queue_inflight: state.getQueueInflight(),
          shutting_down: state.isShuttingDown(),
        },
        error: null,
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "0.1.0",
        },
      });
      return;
    }

    if (method === "GET" && path === "/v1/adapters/health") {
      json(res, 200, {
        ok: true,
        data: {
          adapters: state.getAdapterHealth(),
        },
        error: null,
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "0.1.0",
        },
      });
      return;
    }

    if (method === "POST" && path === "/v1/fetch") {
      state.onActivity();
      void (async () => {
        try {
          if (state.isShuttingDown()) {
            throw new ShuttingDownError();
          }

          const payload = await readJsonBody(req);
          const fetchRequest = validateFetchRequest(payload);
          const result = await state.enqueueFetch(fetchRequest);

          json(res, 200, {
            ok: true,
            data: result,
            error: null,
            meta: {
              request_id: requestId,
              queue_depth: state.getQueueDepth(),
              queue_inflight: state.getQueueInflight(),
              timestamp: new Date().toISOString(),
              version: "0.1.0",
            },
          });
        } catch (error) {
          sendError(res, error);
        }
      })();
      return;
    }

    state.onActivity();
    notFound(req, res);
  });
};
