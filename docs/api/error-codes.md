# API Error Codes and Troubleshooting

All error responses follow:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "retryable": false,
    "details": {}
  },
  "meta": {
    "request_id": "req_xxx",
    "timestamp": "2026-02-12T00:00:00.000Z",
    "version": "0.1.0"
  }
}
```

| Code | HTTP | Meaning | Common Cause | Action |
|---|---:|---|---|---|
| `AUTH_REQUIRED` | 401 | Missing API key | Protected endpoint called without auth header | Send `x-api-key` or `Authorization: Bearer` |
| `AUTH_INVALID` | 401 | API key mismatch | Wrong key value | Verify `API_KEY` and client secret |
| `SIGNATURE_REQUIRED` | 401 | Missing HMAC signature | HMAC signing is enabled but signature headers not provided | Send `x-shadow-signature` and `x-shadow-timestamp` |
| `SIGNATURE_INVALID` | 401 | Invalid HMAC signature | Bad secret, wrong canonical string, or timestamp window violation | Recompute signature and check clock skew |
| `VALIDATION_ERROR` | 400 | Request payload is invalid | Missing required fields, wrong types, timeout out of range | Validate request against OpenAPI/JSON schema |
| `SOURCE_NOT_SUPPORTED` | 400 | Unsupported source | `source` is not one of supported adapters | Use `linkedin`, `x`, or `discord` |
| `OPERATION_NOT_SUPPORTED` | 400 | Unsupported operation for source | Wrong `operation` for adapter | Use adapter-specific operation (`profile`, `server_metadata`) |
| `NOT_FOUND` | 404 | Unknown route | Typo or unsupported endpoint path | Use documented `/v1/*` endpoints |
| `QUEUE_BACKPRESSURE` | 429 | Queue is full | Burst traffic exceeded queue capacity | Retry with backoff |
| `RATE_LIMITED` | 429 | Client rate limit | Client exceeded configured per-window limits | Retry after `Retry-After` and reduce request rate |
| `QUEUE_TIMEOUT` | 504 | Request exceeded queue timeout | Timeout settings too low for work size | Increase queue/task timeout and optimize target workload |
| `QUEUE_CLOSED` | 503 | Queue paused/closed | Service shutting down or maintenance mode | Retry after service recovery |
| `SOURCE_BLOCKED` | 503 | Upstream challenge detected | Captcha/rate-limit/login wall encountered | Retry later, rotate strategy, reduce request rate |
| `SHUTTING_DOWN` | 503 | Service draining | Actor migration or termination in progress | Retry after restart |
| `NAVIGATION_ERROR` | 502 | Browser/navigation failure | Upstream load failures, transient rendering errors | Retry with backoff |
| `INTERNAL_ERROR` | 500 | Unexpected failure | Unhandled runtime exception | Use `request_id` for log lookup and incident triage |

## Troubleshooting Flow

1. Capture `meta.request_id` from error response.
2. Confirm request payload against `docs/api/openapi.json`.
3. Confirm auth settings (`API_KEY_ENABLED`, `API_KEY`) and client headers.
4. For timeout/backpressure failures, inspect queue depth and timeout policy from `/v1/ready`.
5. For source blocking, inspect adapter health endpoint and reduce aggressive polling.
