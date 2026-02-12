# Shadow API

A real-time **"Shadow API"** for websites that do not provide public APIs.

This project aims to provide a fast REST interface (target: **< 2s response time**) on top of non-API web platforms by running an always-warm Apify Actor with resilient scraping and caching.

## Vision

Many high-value platforms (B2B marketplaces, regional portals, and private dashboards) either have no official API or strict access constraints.

`Shadow API` exposes carefully designed API endpoints over these sources so developers can integrate quickly without building and maintaining their own scraping stack.

## Core Product Direction

- Real-time API responses from non-API sources
- Standby mode (warm browser/session pool) for low-latency requests
- Reliable extraction with retries and anti-blocking tactics
- REST-first interface with consistent schemas
- Apify deployment for scalable execution and monetization

## Performance Target

- Median response time: under 2 seconds (for cached/hot paths)
- Fast failure and clear error contracts
- Observability for latency and extraction quality

## Monetization Model

- Subscription rental model: `$50–$100/month`
- Alternative usage model: pay-per-result

## Initial Roadmap

1. Define MVP endpoint set and input/output schema
2. Build core Actor runtime and warm standby architecture
3. Add caching + request deduplication
4. Add anti-blocking and extraction fallbacks
5. Publish to Apify Store with pricing tiers

## P0 Planning Artifacts

Initial P0 product artifacts are documented in `docs/product/`:

- `docs/product/icp-and-verticals.md`
- `docs/product/demand-scorecard.md`
- `docs/product/legal-risk-matrix.md`
- `docs/product/mvp-endpoint-catalog.md`
- `docs/product/response-schema-conventions.md`
- `docs/product/slos-and-reliability-baseline.md`
- `docs/product/pricing-hypotheses.md`
- `docs/product/north-star-metrics-events.md`
- `docs/product/demo-use-cases.md`
- `docs/product/prd-v1.md`

## Legal and Compliance

This project must be used in compliance with each target site's terms of service, local laws, and privacy requirements.

## Runtime Scaffold (P0-11)

The initial Apify Actor scaffold is now in place:

- Actor config: `.actor/actor.json`, `.actor/input_schema.json`
- Runtime source: `src/main.ts`, `src/config.ts`, `src/server.ts`
- Warm runtime managers: `src/runtime/browser-pool.ts`, `src/runtime/standby-lifecycle.ts`
- Build/dev config: `package.json`, `tsconfig.json`, `.env.example`, `Dockerfile`

### Local Quickstart

1. Install dependencies: `npm install`
2. Start in dev mode: `npm run dev`
3. Verify endpoints:
   - `GET http://127.0.0.1:3000/v1/health`
   - `GET http://127.0.0.1:3000/v1/ready`

### Config Validation

Startup now validates runtime config and fails fast with explicit errors when:

- `PORT`/`port` is non-integer or outside `1..65535`
- `HOST`/`host` is empty
- `LOG_LEVEL`/`logLevel` is not one of `DEBUG|INFO|WARNING|ERROR`
- any variable listed in `REQUIRED_ENV_VARS` (or actor input `requiredEnvVars`) is missing

Warm pool and standby controls:

- `BROWSER_POOL_ENABLED` (`true|false`)
- `BROWSER_POOL_SIZE` (warm session count)
- `BROWSER_HEADLESS` (`true|false`)
- `BROWSER_LAUNCH_TIMEOUT_MS`
- `STANDBY_ENABLED` (`true|false`)
- `STANDBY_IDLE_TIMEOUT_MS`
- `STANDBY_TICK_INTERVAL_MS`
- `STANDBY_RECYCLE_AFTER_MS`

Note: when browser pool is enabled, a Playwright-compatible browser must be available in runtime.

## Repository Structure

- `README.md` — project overview and roadmap
- `CONTRIBUTING.md` — contribution guidelines
- `CODE_OF_CONDUCT.md` — community standards
- `SECURITY.md` — vulnerability reporting policy
- `CHANGELOG.md` — release history
- `LICENSE` — project license
- `docs/product/` — P0 product planning and API contract artifacts
- `.actor/` — Apify Actor metadata and input schema
- `src/` — Actor runtime source scaffold
