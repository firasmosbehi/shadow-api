# P0-01: Ideal Customer Profile and Top 3 Launch Verticals

## Ideal Customer Profile (ICP)

### Primary Buyer

- Role: Engineering Manager, Product Manager, or Technical Founder
- Company stage: Seed to Series B
- Team size: 2-25 engineers
- Budget sensitivity: Will pay for speed/reliability over internal scraping maintenance
- Buying trigger: Needs near real-time external data from platforms without stable APIs

### Primary User

- Role: Backend engineer, automation engineer, growth engineer
- Workflow need: Wants API-first integration instead of building anti-bot + extraction stack
- Success metric: Integrate source data in < 1 week with predictable reliability

### Ideal Use Case Attributes

- High data freshness requirements (minutes/hours, not weeks)
- Repeated retrieval from similar entity pages/queries
- Strong downstream business value (lead scoring, alerts, operations automation)
- Low tolerance for integration downtime

## Top 3 Launch Verticals

### 1) Sales and Prospecting Intelligence (B2B)

Why first:

- Clear ROI (more qualified pipeline) and high willingness to pay
- Frequent need for profile/company refreshes from social/professional platforms
- Existing alternatives are expensive and often slow to customize

Example outcome:

- Enrich account/prospect records from non-API sources on demand

### 2) Talent and Recruiting Intelligence

Why second:

- Recruiters and talent platforms need current profile/activity signals
- Time-to-data materially affects hiring throughput
- Buyers value reliability and consistent data schema for ATS/CRM sync

Example outcome:

- Pull candidate profile snapshots and activity context into recruiting workflows

### 3) Community and Creator Intelligence

Why third:

- Teams managing communities (DevRel, growth, moderation) need live signals
- Public community metadata is fragmented and not consistently available via APIs
- High frequency monitoring drives recurring API usage

Example outcome:

- Track community/server/profile changes and trigger operational workflows

## Vertical Prioritization Summary

| Vertical | Willingness to Pay | Data Freshness Need | Integration Urgency | Overall Priority |
|---|---:|---:|---:|---:|
| Sales and Prospecting Intelligence | High | High | High | P0 |
| Talent and Recruiting Intelligence | High | Medium/High | High | P0 |
| Community and Creator Intelligence | Medium/High | High | Medium/High | P0 |

## Go-to-Market Implications

- Positioning: "Sub-2s Shadow API for hard-to-integrate sources"
- Packaging: API-key onboarding + predictable response contracts
- Early customer profile: teams currently maintaining brittle scraping code
