# M5 Performance and Caching

This folder tracks reproducible performance work completed in M5.

## Features Delivered

- In-memory hot cache with TTL
- Optional Redis cache provider fallback path
- Inflight request deduplication
- Stale-while-revalidate cache behavior
- Target prewarming scheduler
- Per-stage latency metrics (extraction + pipeline)
- Partial-response fast mode
- Hot-path benchmark harness

## Benchmark Harness

Run locally:

```bash
npm run benchmark:hot-path
```

Outputs:

- `docs/performance/hot-path-benchmark.json`

Target:

- Hot-path `p50 < 2000ms`

Latest local run (`2026-02-12`):

- `p50 = 4ms`
- `p95 = 6ms`
