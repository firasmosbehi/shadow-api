# Platform Compliance Checklist (Template) (M7)

Use this as a template when adding or operating a Shadow API adapter for a third-party platform.

## Legal/Terms

- [ ] Review Terms of Service for automated access restrictions.
- [ ] Review robots policies where applicable (note: robots is not a license; still check ToS).
- [ ] Confirm allowed data usage and redistribution rights.
- [ ] Confirm jurisdictional requirements (GDPR/CCPA, consumer protection, etc).

## Data Minimization

- [ ] Only collect fields required for the API contract.
- [ ] Default to minimal fields in `fast_mode`.
- [ ] Avoid collecting PII unless explicitly required.
- [ ] Store as little data as possible in caches, logs, and dead-letter queues.

## Rate Limiting and Abuse Controls

- [ ] Configure `RATE_LIMIT_ENABLED=true` with reasonable limits for production.
- [ ] Enforce per-customer quotas at higher layers (billing/plan enforcement).
- [ ] Implement circuit breakers/quarantine to reduce pressure when blocked.

## Security

- [ ] Enable `API_KEY_ENABLED=true` in production.
- [ ] Optionally enable HMAC signing (`HMAC_SIGNING_ENABLED=true`) for tamper prevention.
- [ ] Verify secrets handling per `docs/security/secrets-management.md`.

## Operations

- [ ] Define an incident playbook for blocking spikes (`docs/reliability/incident-playbook.md`).
- [ ] Monitor error codes and rate-limit events.
- [ ] Validate fallback extraction paths and selector drift checks.

