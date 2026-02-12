# P0-03: Legal Risk Matrix and Operating Guardrails

## Important Note

This document is an operational planning artifact and **not legal advice**.
Production use should be reviewed by qualified counsel before launch in each jurisdiction.

## Platform Risk Matrix (Initial)

| Platform | Terms/Access Sensitivity | Data Type Risk | Enforcement Risk | Overall Risk | Recommended Launch Posture |
|---|---:|---:|---:|---:|---|
| LinkedIn | High | High | High | High | Delay broad rollout; require legal sign-off and restrictive controls |
| X (Twitter) | Medium/High | Medium | Medium/High | Medium/High | Launch with conservative limits and strict abuse controls |
| Discord (public metadata) | Medium | Medium | Medium | Medium | Launch only public metadata scope; avoid private/community-restricted data |
| Niche B2B marketplaces | Medium (varies) | Medium | Medium | Medium | Launch per-site legal review and configurable rule profiles |

## Non-Negotiable Guardrails

- No credential stuffing, account takeover, or auth bypass techniques
- No collection of non-public/private data without lawful basis and permission
- Respect platform controls and throttling; do not evade explicit blocks aggressively
- Implement strict per-customer rate limits and abuse detection
- Retain minimum necessary data and support deletion workflows
- Redact sensitive values in logs/traces by default

## Data Usage Boundaries

- Allowed by default: publicly accessible metadata needed for declared customer workflows
- Restricted by default: personal identifiers beyond customer-necessary scope
- Prohibited by default: hidden/private content and data requiring unauthorized access

## Operational Controls by Environment

### Development

- Use synthetic fixtures whenever possible
- Limit real-source runs and isolate keys/secrets

### Staging

- Enable full logging redaction
- Enforce strict request quotas per source

### Production

- Per-source policy toggles
- Kill switch for each adapter
- Auditable access logs and retention policies

## Pre-Launch Legal Checklist

- Terms reviewed for each source platform
- Data categories mapped to lawful basis and policy
- Jurisdiction-specific privacy obligations mapped
- Customer terms + acceptable use policy updated
- Incident response path defined for takedown/compliance requests
