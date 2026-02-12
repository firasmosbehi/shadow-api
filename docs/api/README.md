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
