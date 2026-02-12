# Observability and Operations (M8)

Shadow API exposes operational endpoints and Prometheus metrics for service health, performance, and reliability.

## Endpoints

- `GET /v1/ready` (public even when API key is enabled)
- `GET /v1/debug/performance` (auth required when `API_KEY_ENABLED=true`)
- `GET /v1/debug/reliability` (auth required when `API_KEY_ENABLED=true`)
- `GET /v1/metrics` (Prometheus exposition)
- `GET /v1/admin/diagnostics` (admin; requires API key)
- `POST /v1/admin/purge` (admin; requires API key)

## Correlation IDs and Tracing

- Every request receives:
  - `x-shadow-request-id`
  - `x-shadow-trace-id`
- The response `meta` also includes `trace_id`.
- All logs include `request_id` and `trace_id` fields via AsyncLocalStorage-based context.

## Metrics

Prometheus exposition is available at `GET /v1/metrics`.

Key metrics:

- `shadow_api_http_requests_total{method,path,status}`
- `shadow_api_http_errors_total{method,path,code}`
- `shadow_api_http_request_duration_ms_bucket{method,path,le}`
- `shadow_api_fetch_requests_total{source,operation}`
- `shadow_api_fetch_cost_units_total{source,operation}`
- `shadow_api_fetch_latency_ms_bucket{source,operation,le}`
- `shadow_api_queue_depth`, `shadow_api_queue_inflight`, `shadow_api_warm_sessions`
- `shadow_api_dead_letters_total`, `shadow_api_circuits_open`, `shadow_api_incidents_total`

## Daily Reliability Report

Use `npm run report:daily` to generate a daily report by querying the live service.

Environment variables:

- `SHADOW_API_BASE_URL` (default `http://127.0.0.1:3000`)
- `SHADOW_API_API_KEY` (optional)
- `SHADOW_API_HMAC_SECRET` (optional; if HMAC signing is enabled)
- `REPORT_STORE_NAME` (default `SHADOW_API_REPORTS`)
- `REPORT_WRITE_TO_KV` (default `true`)
- `REPORT_OUT_PATH` (optional file path to also write JSON to disk)

