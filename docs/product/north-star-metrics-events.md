# P0-08: North-Star Metrics and Analytics Events

## North-Star Metric

- Weekly Active Integrations (WAI):
  - Count of distinct API keys making >= 20 successful requests/week

Rationale:

- Captures real production usage beyond trial noise
- Correlates with retention and monetization potential

## Supporting KPI Set

- Activation rate: % of new API keys reaching first successful fetch in 24h
- Time-to-first-success (TTFS): median minutes from key creation to first successful fetch
- 30-day retention: % of activated keys still active in week 4
- Paid conversion: % of active keys on paid plan
- Net revenue retention proxy: expansion events / downgrade events
- Reliability KPI: successful results %, p50/p95 latency by source

## Event Taxonomy (Initial)

### Acquisition/Setup

- `api_key_created`
- `workspace_created`
- `pricing_page_viewed`

### Activation

- `fetch_requested`
- `fetch_succeeded`
- `fetch_failed`
- `first_success_achieved`

### Product Usage

- `source_used`
- `cache_hit`
- `timeout_triggered`
- `rate_limit_hit`

### Monetization

- `trial_started`
- `trial_converted`
- `plan_upgraded`
- `plan_downgraded`
- `overage_charged`

## Required Event Properties

- `request_id`
- `api_key_id`
- `source`
- `operation`
- `latency_ms`
- `ok`
- `error_code` (nullable)
- `timestamp`

## Dashboard Starter Views

- Activation funnel: key created -> first request -> first success -> paid
- Usage health: requests/day, success %, latency p50/p95
- Monetization: MRR, conversion, expansion, churn indicators
