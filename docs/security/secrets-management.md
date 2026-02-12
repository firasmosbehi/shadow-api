# Secrets Management and Rotation Policy (M7)

## What Counts as a Secret Here

- API key (`API_KEY`)
- HMAC signing secrets (`HMAC_SECRETS`)
- Redis URL if it contains credentials (`REDIS_URL`)
- Proxy URLs if they include credentials (`PROXY_POOL_URLS`)
- Incident webhook URL if it contains tokens (`INCIDENT_WEBHOOK_URL`)

## Storage Rules

- Prefer Apify secret inputs and/or environment variables.
- Never commit secrets to the repo.
- Do not embed secrets in fixtures, docs, or example curl commands.

## Logging Rules

- Operational logs must not contain secrets.
- Shadow API supports log redaction via `LOG_REDACTION_ENABLED=true` (default).
  - It redacts values under common sensitive keys (apiKey, authorization, cookie, token, secret, hmac, proxy, etc).

## Rotation Policy

### API key rotation

1. Generate a new API key.
2. Roll out the new key to clients.
3. Update `API_KEY` and redeploy.
4. Revoke the old key.

### HMAC secret rotation

HMAC supports multiple secrets for validation:

- `HMAC_SECRETS=current,previous1,previous2`

Rotation steps:

1. Add the new secret first in `HMAC_SECRETS` (keep the previous secret(s) for a transition window).
2. Roll clients to sign with the new secret.
3. After the transition window, remove old secrets from `HMAC_SECRETS`.

## Incident Response

If a secret is suspected leaked:

1. Rotate the secret immediately.
2. Purge cached/persisted data if it may contain sensitive payloads (`POST /v1/admin/purge`).
3. Audit operational logs for exposure (request IDs and timestamps).

