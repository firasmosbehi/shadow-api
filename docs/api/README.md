# API Contracts (M4)

M4 delivers a stable REST contract for MVP endpoints with standardized envelope responses:

- `GET /v1/health`
- `GET /v1/ready`
- `GET /v1/adapters/health`
- `GET /v1/debug/performance`
- `POST /v1/fetch`

## Authentication

When `API_KEY_ENABLED=true`, all endpoints except `GET /v1/health` and `GET /v1/ready` require API key auth:

- `x-api-key: <key>`
- `Authorization: Bearer <key>`

## Optional HMAC Request Signing (M7)

When `HMAC_SIGNING_ENABLED=true`, protected endpoints additionally require:

- `x-shadow-timestamp: <unix-seconds>`
- `x-shadow-signature: <hex-hmac-sha256>`

Canonical string format:

```
<timestamp>.<METHOD>.<PATH_WITH_QUERY>.<sha256Hex(rawBody)>
```

Signature is `HMAC_SHA256(secret, canonical)` encoded as hex. Configure secrets via `HMAC_SECRETS` (comma-separated; supports rotation).

## Rate Limiting (M7)

When `RATE_LIMIT_ENABLED=true`, requests are limited by:

- global bucket (all requests)
- client IP bucket
- API key bucket (when provided)

Rate limited responses return `429` with `RATE_LIMITED` and may include `Retry-After`.

## Admin Purge (M7)

`POST /v1/admin/purge` clears in-process/persisted state (cache, session slots, dead-letter queue). This endpoint is only available when `API_KEY_ENABLED=true`.

## Timeout Controls

`POST /v1/fetch` enforces endpoint-specific timeout policy:

- `FETCH_TIMEOUT_DEFAULT_MS`
- `FETCH_TIMEOUT_MIN_MS`
- `FETCH_TIMEOUT_MAX_MS`

Request payload `timeout_ms` is validated against this policy.

## Fetch Options

`POST /v1/fetch` supports performance-specific flags:

- `fast_mode` — enable partial-response fast path
- `cache_mode` — `default`, `bypass`, or `refresh`

## Generated Artifacts

- OpenAPI spec: `docs/api/openapi.json`
- Postman collection: `docs/api/postman/shadow-api-mvp.postman_collection.json`

Generate artifacts from source contracts:

```bash
npm run generate:api-artifacts
```

## Validation Commands

```bash
npm run build
npm run verify:fixtures
npm run verify:api-contract
npm run benchmark:hot-path
```
