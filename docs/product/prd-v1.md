# P0-10: Shadow API MVP PRD v1

## 1. Problem Statement

Developers need reliable, low-latency data access from high-value websites that lack official APIs.
Current DIY scraping stacks are brittle, slow to maintain, and expensive to operate.

## 2. Product Goal

Deliver a Shadow API that provides near real-time, normalized REST responses from non-API sources,
with hot-path median latency under 2 seconds.

## 3. Target Users

- Engineering/product teams building automation, enrichment, and monitoring workflows
- Primary verticals: sales intelligence, recruiting intelligence, community intelligence

## 4. MVP Scope

### In Scope

- Warm-standby actor runtime architecture
- API endpoints: `/v1/health`, `/v1/ready`, `/v1/fetch`
- Initial adapters: X, Discord public metadata, one niche B2B source
- Response contract standardization and error taxonomy
- Basic caching + rate limiting + observability baseline

### Out of Scope

- Full LinkedIn production rollout (requires extra legal/operational gates)
- Advanced batch orchestration and SDK ecosystem
- Enterprise SSO and dedicated deployment variants

## 5. User Stories

- As an engineer, I can request normalized source data through one endpoint.
- As an operator, I can monitor service readiness and latency health.
- As a product team, I can integrate quickly without owning scraping internals.

## 6. Functional Requirements

- Authenticated API key access
- Strict request validation and deterministic error responses
- Source + operation routing through adapter interface
- Structured metadata in every response

## 7. Non-Functional Requirements

- p50 hot-path latency <= 2s
- 99.5% monthly availability target
- Redaction of sensitive values in logs
- Adapter-level health monitoring and incident response playbook

## 8. Risks and Constraints

- Terms-of-service variability across sources
- Anti-bot controls causing extraction instability
- Legal/compliance complexity for certain platforms

Mitigations:

- Per-source launch gates and kill switches
- Conservative rate limits and abuse controls
- Formal legal review before high-risk rollouts

## 9. Success Metrics

- Weekly Active Integrations (north star)
- Activation rate within 24h
- 30-day retention of activated keys
- p50/p95 latency and successful extraction rate

## 10. Release Plan

- Phase A: product and contract foundations (P0-01 through P0-10)
- Phase B: runtime and adapter implementation (M2/M3)
- Phase C: performance/reliability hardening and store launch
