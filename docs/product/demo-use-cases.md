# P0-09: Three End-to-End Demo Use Cases

## Demo 1: Sales Prospect Enrichment

### Persona

- Sales ops engineer integrating outbound lead workflows

### Flow

1. CRM pushes target profile URL/handle to Shadow API
2. `POST /v1/fetch` returns normalized profile/company attributes
3. Workflow engine enriches lead score and route assignment

### Success Criteria

- End-to-end response under 2 seconds on hot path
- Schema fields map to CRM custom fields without manual transforms

## Demo 2: Recruiting Signal Refresh

### Persona

- Talent tooling engineer syncing candidate signals to ATS

### Flow

1. Candidate profile targets queued daily
2. API fetch returns normalized profile and activity metadata
3. ATS records updated; stale candidates flagged automatically

### Success Criteria

- >=95% of queued candidates refreshed successfully
- Clear error codes for retries on transient failures

## Demo 3: Community Monitoring Alerting

### Persona

- Community operations manager tracking server/community health

### Flow

1. Scheduler requests community metadata snapshots periodically
2. API returns normalized metrics and change indicators
3. Alerting system notifies on threshold breaches

### Success Criteria

- Reliable recurring polling with stable response contract
- Operational alerts triggered within defined latency budget

## Demo Packaging Checklist

- Example curl requests and sample responses
- One script per use case showing request -> transformation -> action
- Dashboard screenshot or CLI output proving latency + success stats
