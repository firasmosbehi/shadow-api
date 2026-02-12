export const API_VERSION = "0.1.0";

export interface FetchTimeoutPolicy {
  minMs: number;
  maxMs: number;
  defaultMs: number;
}

export interface EndpointContract {
  method: "GET" | "POST";
  path: string;
  summary: string;
  requiresApiKey: boolean;
}

export const MVP_ENDPOINTS: EndpointContract[] = [
  {
    method: "GET",
    path: "/v1/health",
    summary: "Liveness check",
    requiresApiKey: false,
  },
  {
    method: "GET",
    path: "/v1/ready",
    summary: "Readiness check with queue and standby state",
    requiresApiKey: false,
  },
  {
    method: "GET",
    path: "/v1/adapters/health",
    summary: "Adapter health score snapshots",
    requiresApiKey: true,
  },
  {
    method: "GET",
    path: "/v1/debug/performance",
    summary: "Performance and caching telemetry",
    requiresApiKey: true,
  },
  {
    method: "GET",
    path: "/v1/debug/reliability",
    summary: "Reliability snapshot (circuits, quarantine, DLQ, incidents)",
    requiresApiKey: true,
  },
  {
    method: "GET",
    path: "/v1/metrics",
    summary: "Prometheus metrics exposition",
    requiresApiKey: true,
  },
  {
    method: "POST",
    path: "/v1/fetch",
    summary: "Extract normalized data from supported sources",
    requiresApiKey: true,
  },
  {
    method: "GET",
    path: "/v1/admin/diagnostics",
    summary: "Runtime diagnostics snapshot (admin)",
    requiresApiKey: true,
  },
  {
    method: "POST",
    path: "/v1/admin/purge",
    summary: "Purge cache/session/DLQ state (admin)",
    requiresApiKey: true,
  },
];

export const buildFetchRequestSchema = (
  timeoutPolicy: FetchTimeoutPolicy,
): Record<string, unknown> => ({
  $id: "FetchRequestV1",
  type: "object",
  additionalProperties: false,
  required: ["source", "operation", "target"],
  properties: {
    source: {
      type: "string",
      minLength: 1,
      pattern: "\\S",
      examples: ["linkedin", "x", "discord"],
    },
    operation: {
      type: "string",
      minLength: 1,
      pattern: "\\S",
      examples: ["profile", "server_metadata"],
    },
    target: {
      type: "object",
      minProperties: 1,
      additionalProperties: true,
      description:
        "Extraction target. Can include url, handle, inviteCode, html, or mockHtml.",
    },
    fields: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: {
        type: "string",
        minLength: 1,
        pattern: "\\S",
      },
    },
    freshness: {
      type: "string",
      enum: ["hot", "warm", "cold"],
      default: "hot",
    },
    timeout_ms: {
      type: "integer",
      minimum: timeoutPolicy.minMs,
      maximum: timeoutPolicy.maxMs,
      default: timeoutPolicy.defaultMs,
    },
    fast_mode: {
      type: "boolean",
      default: false,
      description: "Enable partial-response fast path for latency-sensitive callers.",
    },
    cache_mode: {
      type: "string",
      enum: ["default", "bypass", "refresh"],
      default: "default",
      description:
        "Cache behavior override. `bypass` skips cache; `refresh` forces refresh and updates cache.",
    },
  },
});

export const EXAMPLES = {
  fetchRequest: {
    source: "x",
    operation: "profile",
    target: {
      handle: "openai",
    },
    fields: ["display_name", "handle", "follower_count"],
    freshness: "hot",
    timeout_ms: 8000,
    fast_mode: false,
    cache_mode: "default",
  },
  fetchResponse: {
    ok: true,
    data: {
      source: "x",
      operation: "profile",
      data: {
        display_name: "OpenAI",
        handle: "openai",
        follower_count: 1500000,
      },
    },
    error: null,
    meta: {
      request_id: "req_123",
      timestamp: "2026-02-12T00:00:00.000Z",
      version: API_VERSION,
    },
  },
  errorResponse: {
    ok: false,
    data: null,
    error: {
      code: "VALIDATION_ERROR",
      message: "Request payload failed schema validation.",
      retryable: false,
      details: {
        issues: ["body/source must be string"],
      },
    },
    meta: {
      request_id: "req_123",
      timestamp: "2026-02-12T00:00:00.000Z",
      version: API_VERSION,
    },
  },
};
