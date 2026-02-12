# P0-06: Baseline SLOs for Latency and Reliability

## SLO Scope (MVP)

This SLO set applies to `GET /v1/health`, `GET /v1/ready`, and `POST /v1/fetch`.
It defines user-facing service expectations for the first production release.

## Service Level Objectives

### Availability SLO

- Monthly availability target: 99.5%
- Measurement: successful responses / total valid requests
- Exclusions: planned maintenance windows announced in advance

### Latency SLO

- `POST /v1/fetch` hot-path p50: <= 2,000 ms
- `POST /v1/fetch` hot-path p95: <= 4,000 ms
- `GET /v1/health` and `GET /v1/ready` p95: <= 300 ms

### Correctness SLO

- Successful extraction parse rate: >= 97% (for supported adapters)
- Response schema conformance: 100% for successful responses

### Error Budget Policy

- Monthly error budget: 0.5% failed availability requests
- Burn trigger 1: >25% budget consumed in 7 days
- Burn trigger 2: >50% budget consumed in 14 days
- Action: freeze non-critical releases and prioritize reliability fixes

## SLI Definitions

- Availability SLI:
  - Numerator: requests returning non-5xx and contract-valid payload
  - Denominator: authenticated, rate-limit-eligible requests
- Latency SLI:
  - End-to-end API time from ingress to final byte sent
- Parse success SLI:
  - Numerator: extraction attempts with valid normalized payload
  - Denominator: extraction attempts that reached source and parser stage

## Monitoring Cadence

- Real-time alerts for p95 spikes and availability degradation
- Daily roll-up report for SLI trends per source adapter
- Weekly review of error-budget burn and mitigations
