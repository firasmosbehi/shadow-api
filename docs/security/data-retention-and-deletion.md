# Data Retention and Deletion Workflow (M7)

Shadow API can persist data in caches and Apify Key-Value stores. This document explains available retention controls and deletion tooling.

## Where Data Can Be Stored

- Cache:
  - in-memory cache (process lifetime)
  - optional Redis cache (`CACHE_PROVIDER=redis`)
- Session storage:
  - Apify KV store (`SESSION_STORE_NAME`) with keys `${SESSION_STORE_KEY_PREFIX}-${slot}`
- Dead-letter queue:
  - Apify KV store (`DEAD_LETTER_STORE_NAME`) storing failed request payloads and errors

## Retention Controls

- Session storage expiry:
  - `SESSION_STORAGE_RETENTION_MS` (0 disables expiry)
  - Expired session slots are cleared on load.
- Dead-letter expiry:
  - `DEAD_LETTER_RETENTION_MS` (0 disables expiry)
  - Expired entries are pruned on init/push (based on entry ID timestamp).
- Cache expiry:
  - `CACHE_TTL_MS` and `CACHE_STALE_TTL_MS`

## Deletion / Purge

### Admin purge endpoint

`POST /v1/admin/purge` clears:

- cache (memory/redis where supported)
- persisted session slots (0..`BROWSER_POOL_SIZE-1`)
- dead-letter entries

This endpoint is only available when `API_KEY_ENABLED=true`. If HMAC signing is enabled, it also requires signature headers.

### GDPR/CCPA notes

This MVP purge is global and does not implement subject-based deletion (requires a stable subject identifier mapping).
If you need user-specific deletion, implement higher-level customer-specific storage partitioning and lookup indexes.

