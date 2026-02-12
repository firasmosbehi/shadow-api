# P0-05: Response Schema Conventions

## Goals

- Predictable response shape across all endpoints
- Uniform success/error handling for client SDKs
- Explicit metadata for observability and debugging

## Global Conventions

- Content type: `application/json; charset=utf-8`
- Key style: `snake_case`
- Timestamps: ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- IDs: opaque strings (`request_id`, `trace_id`)
- Empty collections: `[]` (not `null`)

## Standard Envelope

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "request_id": "req_01H...",
    "trace_id": "trc_01H...",
    "source": "x",
    "operation": "profile",
    "cache": {
      "hit": true,
      "ttl_ms": 12000,
      "mode": "hot"
    },
    "latency_ms": 842,
    "timestamp": "2026-02-12T21:00:00.000Z",
    "version": "0.1.0"
  }
}
```

## Error Envelope

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "SOURCE_TIMEOUT",
    "message": "Source request exceeded timeout budget.",
    "retryable": true,
    "details": {
      "source": "x",
      "timeout_ms": 2000
    }
  },
  "meta": {
    "request_id": "req_01H...",
    "trace_id": "trc_01H...",
    "latency_ms": 2013,
    "timestamp": "2026-02-12T21:00:02.013Z",
    "version": "0.1.0"
  }
}
```

## Error Code Taxonomy (Initial)

- `VALIDATION_ERROR` (400)
- `AUTH_INVALID_KEY` (401)
- `AUTH_FORBIDDEN` (403)
- `RATE_LIMITED` (429)
- `SOURCE_NOT_SUPPORTED` (400)
- `SOURCE_BLOCKED` (503)
- `SOURCE_TIMEOUT` (504)
- `SOURCE_PARSE_ERROR` (502)
- `INTERNAL_ERROR` (500)

## Field Normalization Rules

- Normalize platform-specific names into stable domain fields
- Include raw-source artifacts only behind explicit debug flags
- Use nullable primitives only when semantically unknown (not omitted)
- Prefer additive schema evolution; avoid breaking field renames/removals

## Backward Compatibility Policy

- No breaking response shape changes in same minor version
- Additions allowed if existing fields remain intact
- Deprecations must be documented at least one release ahead
