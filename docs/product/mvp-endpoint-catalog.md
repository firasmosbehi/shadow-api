# P0-04: MVP Endpoint Catalog and Priorities

## API Design Principles

- Single entry for extraction jobs with explicit adapter/source routing
- Stable response envelope for all outcomes
- Fast-path support for minimal fields and hot cache
- Deterministic error contracts for integration reliability

## Endpoint Catalog (MVP)

| Endpoint | Priority | Purpose | Required Input | Core Output |
|---|---|---|---|---|
| `GET /v1/health` | P0 | Liveness check | None | service status, version, uptime |
| `GET /v1/ready` | P0 | Readiness check (warm pool/queue) | None | readiness state, queue depth, warm sessions |
| `POST /v1/fetch` | P0 | Fetch normalized data from a target source | `source`, `operation`, `target`, `fields` | normalized payload + metadata |
| `POST /v1/fetch/batch` | P1 | Batch fetch across many targets | `requests[]` | per-item results + aggregate summary |
| `GET /v1/sources` | P1 | List available adapters and capabilities | None | adapters, operations, limits |

## `POST /v1/fetch` Contract (MVP)

### Request Body

- `source` (string): target platform identifier (e.g. `x`, `discord`, `linkedin`)
- `operation` (string): operation type (e.g. `profile`, `posts`, `community`)
- `target` (object): source-specific targeting keys (e.g. handle, URL, ID)
- `fields` (array<string>, optional): requested field subset
- `freshness` (enum, optional): `hot`, `warm`, `live`
- `timeout_ms` (number, optional): caller max timeout budget

### Response Body

- Standard envelope defined in `response-schema-conventions.md`
- `data` carries normalized result for requested operation
- `meta` includes latency, source, adapter version, cache status

## Priority Rationale

### P0

- `health`, `ready`, and `fetch` are the minimum viable integration surface
- Supports core customer value with smallest stable API footprint

### P1

- Batch + source discovery improve efficiency/usability after core reliability is proven

## Initial Rate Limit Targets

- Default key: 60 requests/minute burst, 600/hour sustained
- Source-level overrides where required by risk/compliance policy
