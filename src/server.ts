import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { RuntimeConfig } from "./types";

const json = (res: ServerResponse, statusCode: number, body: unknown): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const notFound = (req: IncomingMessage, res: ServerResponse): void => {
  json(res, 404, {
    ok: false,
    data: null,
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method ?? "GET"} ${req.url ?? "/"}`,
      retryable: false,
      details: null,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    },
  });
};

export const createApiServer = (runtime: RuntimeConfig): Server => {
  const startedAt = new Date();

  return createServer((req, res) => {
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
          ready: true,
          queue_depth: 0,
          warm_sessions: 0,
          host: runtime.host,
          port: runtime.port,
        },
        error: null,
        meta: {
          timestamp: new Date().toISOString(),
          version: "0.1.0",
        },
      });
      return;
    }

    notFound(req, res);
  });
};
