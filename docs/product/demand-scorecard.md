# P0-02: Demand Scorecard for Candidate Source Sites

## Scoring Model

Score each source from 1 (low) to 5 (high).

- Market demand (weight 35%)
- Willingness to pay (weight 25%)
- Data freshness value (weight 20%)
- Technical feasibility (weight 10%, higher is easier)
- Legal/compliance feasibility (weight 10%, higher is safer)

Weighted score = sum(score * weight).

## Candidate Source Scorecard

| Source | Market Demand | Willingness to Pay | Freshness Value | Technical Feasibility | Legal Feasibility | Weighted Score |
|---|---:|---:|---:|---:|---:|---:|
| LinkedIn | 5 | 5 | 4 | 2 | 1 | 4.10 |
| X (Twitter) | 4 | 4 | 5 | 3 | 2 | 3.85 |
| Discord (public metadata) | 4 | 4 | 4 | 3 | 3 | 3.80 |
| Niche B2B directories/marketplaces | 4 | 4 | 3 | 4 | 3 | 3.75 |
| Regional real estate portals | 3 | 3 | 4 | 3 | 3 | 3.20 |

## Interpretation

- LinkedIn has the strongest demand/monetization signal, but highest legal and technical risk.
- X and Discord provide strong near-term value with moderately better execution feasibility.
- Niche B2B portals are excellent "quick-win" expansion targets after core adapters stabilize.

## Recommended Launch Sequence

### Wave 1 (MVP)

- X profile/activity snapshots
- Discord public community metadata
- One niche B2B marketplace adapter as reference pattern

### Wave 2

- LinkedIn profile extraction with strict controls and legal review gates
- Additional vertical-specific portal adapters

## Decision Gates Before Source Launch

- Legal review complete for source and region
- Adapter achieves baseline extraction reliability target
- Response schema normalized and covered by contract tests
- p50 latency within SLO for hot-path requests
