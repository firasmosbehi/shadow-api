# P0-07: Pricing Hypotheses (Subscription + Usage)

## Pricing Objectives

- Capture high-value integrations that need speed/reliability
- Keep entry point low enough for early-stage teams
- Align upper tiers with business-critical usage and support needs

## Hypothesis A: Subscription Tiers

| Plan | Monthly Price | Included Requests | SLA Target | Intended Customer |
|---|---:|---:|---|---|
| Starter | $49 | 20,000 | Best effort | Solo devs / early prototypes |
| Growth | $99 | 75,000 | 99.5% | Small product teams |
| Pro | $249 | 250,000 | 99.9% target posture | Data-heavy automation teams |

Assumptions:

- Most early paid users convert at $49-$99 range
- Reliability + low-latency are primary differentiators vs DIY scraping
- Overages can contribute meaningful expansion revenue

## Hypothesis B: Pay-Per-Result

| Unit | Price |
|---|---:|
| Successful result | $0.005 - $0.02 |

Assumptions:

- Attractive for sporadic or bursty workloads
- Lower commitment helps initial trials
- Requires clear result definition and transparent metering

## Hybrid Recommendation (MVP)

- Offer subscription as default packaging
- Add pay-per-result as optional fallback for low-volume users
- Include transparent usage dashboard and alerts at 80/100% quota

## Experiment Plan

- Track conversion by plan shown on pricing page
- A/B test starter price ($49 vs $59)
- Track expansion via overage upgrades
- Evaluate 30-day retention by segment
