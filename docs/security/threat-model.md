# Threat Model and Mitigation Review (M7)

## Assets

- Customer credentials/secrets:
  - `API_KEY`
  - `HMAC_SECRETS`
- Customer request payloads (may contain PII)
- Extracted responses (may contain PII)
- Persisted state:
  - session storage KV store
  - dead-letter queue KV store
  - cache (memory/redis)
- Service availability and latency SLOs

## Trust Boundaries

- Public internet client -> Shadow API HTTP server
- Shadow API -> upstream target platforms
- Shadow API -> Redis (optional)
- Shadow API -> Apify KV store

## Threats and Mitigations

### Unauthorized access

- Mitigation:
  - API key auth (`API_KEY_ENABLED=true`)
  - Optional request signing (`HMAC_SIGNING_ENABLED=true`)

### Request tampering / replay

- Mitigation:
  - HMAC signing over canonical string including body hash and timestamp
  - Timestamp skew enforcement (`HMAC_MAX_SKEW_SEC`)

### Noisy neighbor / scraping abuse

- Mitigation:
  - Rate limiting (`RATE_LIMIT_ENABLED=true`)
  - Queue backpressure
  - Circuit breakers and quarantines (M6)

### Sensitive data exposure via logs

- Mitigation:
  - Log redaction (`LOG_REDACTION_ENABLED=true`)
  - Avoid logging request bodies

### Persisted PII retention

- Mitigation:
  - TTL-based cache
  - Session storage expiry (`SESSION_STORAGE_RETENTION_MS`)
  - Dead-letter retention (`DEAD_LETTER_RETENTION_MS`)
  - Admin purge endpoint (`POST /v1/admin/purge`)

### Dependency / container vulnerabilities

- Mitigation:
  - GitHub Actions scans (npm audit + Trivy)
  - Dependabot updates for npm and GitHub Actions

## Residual Risk

- Target site ToS enforcement and IP bans (managed with M6 reliability controls).
- Full GDPR/CCPA subject-based deletion requires higher-level identity mapping beyond this MVP.

