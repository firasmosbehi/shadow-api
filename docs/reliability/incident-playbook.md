# M6 Incident Playbook

This playbook is for reliability incidents in Shadow API: source blocking spikes, repeated circuit opens, dead-letter growth, and degraded latency.

## Severity Model

- `SEV-1`: API unavailable for one or more core sources (`/v1/fetch` mostly failing for >10 min).
- `SEV-2`: Significant degradation (retry storm, high 5xx rate, p95 latency regression).
- `SEV-3`: Localized adapter/source issue with workaround.

## Detection Signals

- `GET /v1/debug/reliability`
  - `incidents.blocked_events_last_10m` rising sharply.
  - `circuits[*].state` open/half_open for sustained periods.
  - `dead_letters.total` increasing quickly.
  - `quarantine.sources` or `quarantine.proxies` persistent entries.
- `GET /v1/debug/performance`
  - increased `pipeline.latency.p95_ms`, low cache hit ratio.
- `GET /v1/adapters/health`
  - adapter error rates increasing for a specific source.

## First 15 Minutes (Triage)

1. Confirm blast radius:
   - Which source(s): `linkedin`, `x`, `discord`.
   - Which operations affected (`profile`, `server_metadata`, etc.).
2. Pull current runtime state:
   - `GET /v1/debug/reliability`
   - `GET /v1/debug/performance`
   - `GET /v1/adapters/health`
3. Classify failure pattern:
   - `SOURCE_BLOCKED` / `SOURCE_QUARANTINED`: anti-bot pressure.
   - `CIRCUIT_OPEN`: repeated source-level failures.
   - `VALIDATION_ERROR` timeout/network bursts: transport instability.
4. Decide severity (`SEV-1/2/3`) and start incident channel/log.

## Mitigation Runbook

### Blocking Spike

1. Reduce pressure:
   - lower `REQUEST_QUEUE_CONCURRENCY`
   - increase `RETRY_BLOCKED_DELAY_MS`
2. Increase source/proxy cooldown:
   - increase `SOURCE_QUARANTINE_MS`
   - increase `PROXY_QUARANTINE_MS`
3. Verify fallback routing is enabled:
   - `FALLBACK_URL_STRATEGY_ENABLED=true`
4. Confirm blocked trend is dropping via `/v1/debug/reliability`.

### Circuit Flapping

1. Increase `CIRCUIT_OPEN_MS` temporarily.
2. Increase `CIRCUIT_FAILURE_THRESHOLD` if false positives are likely.
3. Confirm `RETRY_MAX_ATTEMPTS` is not too high (avoid retry amplification).
4. Track transition back to `closed` state.

### Dead-Letter Growth

1. Sample `dead_letters.recent` and cluster by `error.code`.
2. If adapter/selector drift:
   - prioritize extraction fallback fixes.
3. If transport:
   - inspect proxy/fingerprint pool health.
4. Keep DLQ retention (`DEAD_LETTER_MAX_ENTRIES`) high enough to preserve evidence.

## Recovery Criteria

Incident can be closed when all are true for at least 30 minutes:

- no critical blocked spike events,
- circuits mostly `closed`,
- dead-letter growth flat,
- `/v1/fetch` success rate and latency back to baseline.

## Post-Incident Checklist

1. Export evidence:
   - reliability snapshot,
   - adapter health snapshot,
   - performance snapshot.
2. Document:
   - root cause,
   - contributing factors,
   - what mitigations worked/failed.
3. Create follow-up tickets:
   - selector hardening,
   - retry/circuit tuning,
   - proxy/fingerprint pool updates,
   - test fixture additions.
