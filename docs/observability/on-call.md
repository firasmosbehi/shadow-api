# On-Call Rotation and Escalation Policy (M8)

This is a lightweight policy template for operating Shadow API in production.

## Roles

- Primary on-call: first responder
- Secondary on-call: backup/responder if primary is unavailable
- Engineering manager: escalation point for customer-impacting incidents

## Rotation

- Rotation cadence: weekly
- Handoff: Monday 09:00 local time
- Coverage: 24/7 during launch; can be reduced after stable SLA

## Severity Levels

- `SEV-1`: API unavailable or widespread failures for core endpoints/sources
- `SEV-2`: major degradation (high error rate, p95 latency breach, retry storm)
- `SEV-3`: localized issue or partial degradation with workaround

## Alert Intake

Alerts should include:

- environment (dev/staging/prod)
- request/trace IDs
- impacted sources/operations
- runbook URL

## Escalation

1. Primary on-call acknowledges within 5 minutes.
2. If no ack in 10 minutes, page secondary.
3. If customer impact persists >30 minutes, page engineering manager.

## Runbooks

- Blocking / anti-bot spike: `docs/reliability/incident-playbook.md`
- Security escalation: `SECURITY.md`

## Post-Incident

- Write a short postmortem for `SEV-1` and `SEV-2`.
- Capture:
  - timeline
  - root cause
  - corrective actions (tickets)
  - metrics before/after

