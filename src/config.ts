import { config as loadDotEnv } from "dotenv";
import type { ActorInput, RuntimeConfig } from "./types";

loadDotEnv();

const ALLOWED_LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"] as const;
const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "off"]);

export class ConfigValidationError extends Error {
  public readonly issues: string[];

  public constructor(issues: string[]) {
    super(
      `Configuration validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

const parseRequiredEnvVars = (
  inputList: string[] | undefined,
  envList: string | undefined,
): string[] => {
  if (Array.isArray(inputList) && inputList.length > 0) {
    return [...new Set(inputList.map((entry) => entry.trim()).filter(Boolean))];
  }

  if (!envList) return [];
  return [...new Set(envList.split(",").map((entry) => entry.trim()).filter(Boolean))];
};

const parseStringList = (
  inputList: string[] | undefined,
  envList: string | undefined,
): string[] => {
  if (Array.isArray(inputList)) {
    return [...new Set(inputList.map((entry) => String(entry).trim()).filter(Boolean))];
  }
  if (!envList) return [];
  return [...new Set(envList.split(",").map((entry) => entry.trim()).filter(Boolean))];
};

const parseBooleanWithValidation = (
  value: boolean | string | undefined,
  fieldName: string,
  issues: string[],
  fallback: boolean,
): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  issues.push(
    `\`${fieldName}\` must be a boolean (true/false, 1/0, yes/no). Received: ${JSON.stringify(value)}.`,
  );
  return fallback;
};

const parseIntegerWithRangeValidation = (
  value: number | string | undefined,
  fieldName: string,
  issues: string[],
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : fallback;

  if (!Number.isInteger(parsed)) {
    issues.push(`\`${fieldName}\` must be an integer. Received: ${JSON.stringify(value)}.`);
    return fallback;
  }
  if (parsed < min || parsed > max) {
    issues.push(`\`${fieldName}\` must be within ${min}-${max}. Received: ${parsed}.`);
    return fallback;
  }
  return parsed;
};

const parseNonEmptyString = (
  value: string | undefined,
  fieldName: string,
  issues: string[],
  fallback: string,
): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (!normalized) {
    issues.push(`\`${fieldName}\` must be a non-empty string.`);
    return fallback;
  }
  return normalized;
};

const parseEnumWithValidation = <T extends string>(
  value: string | undefined,
  fieldName: string,
  issues: string[],
  fallback: T,
  allowed: readonly T[],
): T => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  const matched = allowed.find((entry) => entry.toLowerCase() === normalized);
  if (!matched) {
    issues.push(
      `\`${fieldName}\` must be one of ${allowed.join(", ")}. Received: ${JSON.stringify(value)}.`,
    );
    return fallback;
  }
  return matched;
};

const parseObjectArray = (
  value: Array<Record<string, unknown>> | string | undefined,
  fieldName: string,
  issues: string[],
): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "object" && entry !== null);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      issues.push(`\`${fieldName}\` must be a JSON array of objects.`);
      return [];
    }
    return parsed.filter(
      (entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry),
    ) as Array<Record<string, unknown>>;
  } catch {
    issues.push(`\`${fieldName}\` must be valid JSON array when provided as string.`);
    return [];
  }
};

export const buildRuntimeConfig = (input: ActorInput): RuntimeConfig => {
  const issues: string[] = [];

  const envHost = process.env.HOST;
  const envPort = process.env.PORT;
  const envLogLevel = process.env.LOG_LEVEL;
  const envRequiredEnvVars = process.env.REQUIRED_ENV_VARS;
  const envApiKeyEnabled = process.env.API_KEY_ENABLED;
  const envApiKey = process.env.API_KEY;
  const envBrowserPoolEnabled = process.env.BROWSER_POOL_ENABLED;
  const envBrowserPoolSize = process.env.BROWSER_POOL_SIZE;
  const envBrowserHeadless = process.env.BROWSER_HEADLESS;
  const envBrowserLaunchTimeoutMs = process.env.BROWSER_LAUNCH_TIMEOUT_MS;
  const envStandbyEnabled = process.env.STANDBY_ENABLED;
  const envStandbyIdleTimeoutMs = process.env.STANDBY_IDLE_TIMEOUT_MS;
  const envStandbyTickIntervalMs = process.env.STANDBY_TICK_INTERVAL_MS;
  const envStandbyRecycleAfterMs = process.env.STANDBY_RECYCLE_AFTER_MS;
  const envSessionStorageEnabled = process.env.SESSION_STORAGE_ENABLED;
  const envSessionStoreName = process.env.SESSION_STORE_NAME;
  const envSessionStoreKeyPrefix = process.env.SESSION_STORE_KEY_PREFIX;
  const envRequestQueueConcurrency = process.env.REQUEST_QUEUE_CONCURRENCY;
  const envRequestQueueMaxSize = process.env.REQUEST_QUEUE_MAX_SIZE;
  const envRequestQueueTaskTimeoutMs = process.env.REQUEST_QUEUE_TASK_TIMEOUT_MS;
  const envFetchTimeoutDefaultMs = process.env.FETCH_TIMEOUT_DEFAULT_MS;
  const envFetchTimeoutMinMs = process.env.FETCH_TIMEOUT_MIN_MS;
  const envFetchTimeoutMaxMs = process.env.FETCH_TIMEOUT_MAX_MS;
  const envRequestBodyMaxBytes = process.env.REQUEST_BODY_MAX_BYTES;
  const envCacheProvider = process.env.CACHE_PROVIDER;
  const envCacheTtlMs = process.env.CACHE_TTL_MS;
  const envCacheStaleTtlMs = process.env.CACHE_STALE_TTL_MS;
  const envCacheSwrEnabled = process.env.CACHE_SWR_ENABLED;
  const envRedisUrl = process.env.REDIS_URL;
  const envRedisKeyPrefix = process.env.REDIS_KEY_PREFIX;
  const envFastModeEnabled = process.env.FAST_MODE_ENABLED;
  const envFastModeMaxFields = process.env.FAST_MODE_MAX_FIELDS;
  const envPrewarmEnabled = process.env.PREWARM_ENABLED;
  const envPrewarmIntervalMs = process.env.PREWARM_INTERVAL_MS;
  const envPrewarmTargets = process.env.PREWARM_TARGETS;
  const envBrowserOptimizedFlagsEnabled = process.env.BROWSER_OPTIMIZED_FLAGS_ENABLED;
  const envBrowserBlockResources = process.env.BROWSER_BLOCK_RESOURCES;
  const envProxyRotationEnabled = process.env.PROXY_ROTATION_ENABLED;
  const envProxyPoolUrls = process.env.PROXY_POOL_URLS;
  const envProxyQuarantineMs = process.env.PROXY_QUARANTINE_MS;
  const envFingerprintRotationEnabled = process.env.FINGERPRINT_ROTATION_ENABLED;
  const envRetryMaxAttempts = process.env.RETRY_MAX_ATTEMPTS;
  const envRetryBaseDelayMs = process.env.RETRY_BASE_DELAY_MS;
  const envRetryMaxDelayMs = process.env.RETRY_MAX_DELAY_MS;
  const envRetryBlockedDelayMs = process.env.RETRY_BLOCKED_DELAY_MS;
  const envRetryJitterMs = process.env.RETRY_JITTER_MS;
  const envCircuitBreakerEnabled = process.env.CIRCUIT_BREAKER_ENABLED;
  const envCircuitFailureThreshold = process.env.CIRCUIT_FAILURE_THRESHOLD;
  const envCircuitOpenMs = process.env.CIRCUIT_OPEN_MS;
  const envCircuitHalfOpenSuccessThreshold = process.env.CIRCUIT_HALF_OPEN_SUCCESS_THRESHOLD;
  const envSourceQuarantineMs = process.env.SOURCE_QUARANTINE_MS;
  const envFallbackUrlStrategyEnabled = process.env.FALLBACK_URL_STRATEGY_ENABLED;
  const envCheckpointMaxEntries = process.env.CHECKPOINT_MAX_ENTRIES;
  const envDeadLetterEnabled = process.env.DEAD_LETTER_ENABLED;
  const envDeadLetterStoreName = process.env.DEAD_LETTER_STORE_NAME;
  const envDeadLetterMaxEntries = process.env.DEAD_LETTER_MAX_ENTRIES;
  const envIncidentBlockedSpikeThreshold = process.env.INCIDENT_BLOCKED_SPIKE_THRESHOLD;
  const envIncidentBlockedSpikeWindowMs = process.env.INCIDENT_BLOCKED_SPIKE_WINDOW_MS;
  const envIncidentWebhookUrl = process.env.INCIDENT_WEBHOOK_URL;
  const envShutdownDrainTimeoutMs = process.env.SHUTDOWN_DRAIN_TIMEOUT_MS;
  const envMockFetchDelayMs = process.env.MOCK_FETCH_DELAY_MS;

  const rawHost = input.host ?? envHost ?? "0.0.0.0";
  const host = typeof rawHost === "string" ? rawHost.trim() : "";
  if (!host) {
    issues.push("`host` must be a non-empty string (input `host` or env `HOST`).");
  }

  const rawPort = input.port ?? envPort;
  const parsedPort = parseIntegerWithRangeValidation(rawPort, "port", issues, 3000, 1, 65535);

  const rawLogLevel = input.logLevel ?? envLogLevel ?? "INFO";
  const logLevel = String(rawLogLevel).toUpperCase() as RuntimeConfig["logLevel"];
  if (!ALLOWED_LOG_LEVELS.includes(logLevel)) {
    issues.push(
      `\`logLevel\` must be one of ${ALLOWED_LOG_LEVELS.join(", ")}. Received: ${JSON.stringify(rawLogLevel)} (input \`logLevel\` or env \`LOG_LEVEL\`).`,
    );
  }

  const requiredEnvVars = parseRequiredEnvVars(input.requiredEnvVars, envRequiredEnvVars);
  for (const envName of requiredEnvVars) {
    if (!process.env[envName]) {
      issues.push(
        `Required env var \`${envName}\` is missing. Set it before starting the actor.`,
      );
    }
  }

  const apiKeyEnabled = parseBooleanWithValidation(
    input.apiKeyEnabled ?? envApiKeyEnabled,
    "apiKeyEnabled",
    issues,
    false,
  );

  const apiKeyRaw = input.apiKey ?? envApiKey;
  const apiKey = typeof apiKeyRaw === "string" && apiKeyRaw.trim().length > 0 ? apiKeyRaw.trim() : null;
  if (apiKeyEnabled && !apiKey) {
    issues.push(
      "`apiKey` is required when `apiKeyEnabled=true` (input `apiKey` or env `API_KEY`).",
    );
  }

  const browserPoolEnabled = parseBooleanWithValidation(
    input.browserPoolEnabled ?? envBrowserPoolEnabled,
    "browserPoolEnabled",
    issues,
    true,
  );

  const browserPoolSize = parseIntegerWithRangeValidation(
    input.browserPoolSize ?? envBrowserPoolSize,
    "browserPoolSize",
    issues,
    1,
    0,
    20,
  );

  const browserHeadless = parseBooleanWithValidation(
    input.browserHeadless ?? envBrowserHeadless,
    "browserHeadless",
    issues,
    true,
  );

  const browserLaunchTimeoutMs = parseIntegerWithRangeValidation(
    input.browserLaunchTimeoutMs ?? envBrowserLaunchTimeoutMs,
    "browserLaunchTimeoutMs",
    issues,
    30000,
    1000,
    120000,
  );

  const standbyEnabled = parseBooleanWithValidation(
    input.standbyEnabled ?? envStandbyEnabled,
    "standbyEnabled",
    issues,
    true,
  );

  const standbyIdleTimeoutMs = parseIntegerWithRangeValidation(
    input.standbyIdleTimeoutMs ?? envStandbyIdleTimeoutMs,
    "standbyIdleTimeoutMs",
    issues,
    60000,
    1000,
    3600000,
  );

  const standbyTickIntervalMs = parseIntegerWithRangeValidation(
    input.standbyTickIntervalMs ?? envStandbyTickIntervalMs,
    "standbyTickIntervalMs",
    issues,
    10000,
    1000,
    300000,
  );

  const standbyRecycleAfterMs = parseIntegerWithRangeValidation(
    input.standbyRecycleAfterMs ?? envStandbyRecycleAfterMs,
    "standbyRecycleAfterMs",
    issues,
    900000,
    1000,
    7200000,
  );

  const sessionStorageEnabled = parseBooleanWithValidation(
    input.sessionStorageEnabled ?? envSessionStorageEnabled,
    "sessionStorageEnabled",
    issues,
    true,
  );

  const sessionStoreName = parseNonEmptyString(
    input.sessionStoreName ?? envSessionStoreName,
    "sessionStoreName",
    issues,
    "SHADOW_API_SESSIONS",
  );

  const sessionStoreKeyPrefix = parseNonEmptyString(
    input.sessionStoreKeyPrefix ?? envSessionStoreKeyPrefix,
    "sessionStoreKeyPrefix",
    issues,
    "session-slot",
  );

  const requestQueueConcurrency = parseIntegerWithRangeValidation(
    input.requestQueueConcurrency ?? envRequestQueueConcurrency,
    "requestQueueConcurrency",
    issues,
    2,
    1,
    50,
  );

  const requestQueueMaxSize = parseIntegerWithRangeValidation(
    input.requestQueueMaxSize ?? envRequestQueueMaxSize,
    "requestQueueMaxSize",
    issues,
    100,
    1,
    10000,
  );

  const requestQueueTaskTimeoutMs = parseIntegerWithRangeValidation(
    input.requestQueueTaskTimeoutMs ?? envRequestQueueTaskTimeoutMs,
    "requestQueueTaskTimeoutMs",
    issues,
    15000,
    1000,
    600000,
  );

  const fetchTimeoutDefaultMs = parseIntegerWithRangeValidation(
    input.fetchTimeoutDefaultMs ?? envFetchTimeoutDefaultMs,
    "fetchTimeoutDefaultMs",
    issues,
    8000,
    1000,
    600000,
  );

  const fetchTimeoutMinMs = parseIntegerWithRangeValidation(
    input.fetchTimeoutMinMs ?? envFetchTimeoutMinMs,
    "fetchTimeoutMinMs",
    issues,
    1000,
    500,
    600000,
  );

  const fetchTimeoutMaxMs = parseIntegerWithRangeValidation(
    input.fetchTimeoutMaxMs ?? envFetchTimeoutMaxMs,
    "fetchTimeoutMaxMs",
    issues,
    15000,
    1000,
    600000,
  );

  if (fetchTimeoutMinMs > fetchTimeoutMaxMs) {
    issues.push(
      "`fetchTimeoutMinMs` must be less than or equal to `fetchTimeoutMaxMs`.",
    );
  }
  if (fetchTimeoutDefaultMs < fetchTimeoutMinMs || fetchTimeoutDefaultMs > fetchTimeoutMaxMs) {
    issues.push(
      "`fetchTimeoutDefaultMs` must be within fetch timeout min/max bounds.",
    );
  }
  if (requestQueueTaskTimeoutMs < fetchTimeoutMaxMs) {
    issues.push(
      "`requestQueueTaskTimeoutMs` must be greater than or equal to `fetchTimeoutMaxMs`.",
    );
  }

  const requestBodyMaxBytes = parseIntegerWithRangeValidation(
    input.requestBodyMaxBytes ?? envRequestBodyMaxBytes,
    "requestBodyMaxBytes",
    issues,
    1_000_000,
    1_024,
    10_000_000,
  );

  const cacheProvider = parseEnumWithValidation(
    input.cacheProvider ?? envCacheProvider,
    "cacheProvider",
    issues,
    "memory",
    ["memory", "redis"] as const,
  );

  const cacheTtlMs = parseIntegerWithRangeValidation(
    input.cacheTtlMs ?? envCacheTtlMs,
    "cacheTtlMs",
    issues,
    120000,
    1000,
    3600000,
  );

  const cacheStaleTtlMs = parseIntegerWithRangeValidation(
    input.cacheStaleTtlMs ?? envCacheStaleTtlMs,
    "cacheStaleTtlMs",
    issues,
    300000,
    0,
    3600000,
  );

  const cacheSwrEnabled = parseBooleanWithValidation(
    input.cacheSwrEnabled ?? envCacheSwrEnabled,
    "cacheSwrEnabled",
    issues,
    true,
  );

  const redisUrlRaw = input.redisUrl ?? envRedisUrl;
  const redisUrl =
    typeof redisUrlRaw === "string" && redisUrlRaw.trim().length > 0
      ? redisUrlRaw.trim()
      : null;

  const redisKeyPrefix = parseNonEmptyString(
    input.redisKeyPrefix ?? envRedisKeyPrefix,
    "redisKeyPrefix",
    issues,
    "shadow-api:cache",
  );

  if (cacheProvider === "redis" && !redisUrl) {
    issues.push("`redisUrl` must be set when `cacheProvider=redis`.");
  }

  const fastModeEnabled = parseBooleanWithValidation(
    input.fastModeEnabled ?? envFastModeEnabled,
    "fastModeEnabled",
    issues,
    true,
  );

  const fastModeMaxFields = parseIntegerWithRangeValidation(
    input.fastModeMaxFields ?? envFastModeMaxFields,
    "fastModeMaxFields",
    issues,
    3,
    1,
    20,
  );

  const prewarmEnabled = parseBooleanWithValidation(
    input.prewarmEnabled ?? envPrewarmEnabled,
    "prewarmEnabled",
    issues,
    false,
  );

  const prewarmIntervalMs = parseIntegerWithRangeValidation(
    input.prewarmIntervalMs ?? envPrewarmIntervalMs,
    "prewarmIntervalMs",
    issues,
    30000,
    1000,
    3600000,
  );

  const prewarmTargets = parseObjectArray(
    input.prewarmTargets ?? envPrewarmTargets,
    "prewarmTargets",
    issues,
  );

  const browserOptimizedFlagsEnabled = parseBooleanWithValidation(
    input.browserOptimizedFlagsEnabled ?? envBrowserOptimizedFlagsEnabled,
    "browserOptimizedFlagsEnabled",
    issues,
    true,
  );

  const browserBlockResources = parseBooleanWithValidation(
    input.browserBlockResources ?? envBrowserBlockResources,
    "browserBlockResources",
    issues,
    true,
  );

  const proxyRotationEnabled = parseBooleanWithValidation(
    input.proxyRotationEnabled ?? envProxyRotationEnabled,
    "proxyRotationEnabled",
    issues,
    false,
  );

  const proxyPoolUrls = parseStringList(input.proxyPoolUrls, envProxyPoolUrls);
  if (proxyRotationEnabled && proxyPoolUrls.length === 0) {
    issues.push(
      "`proxyPoolUrls` must contain at least one URL when `proxyRotationEnabled=true`.",
    );
  }

  const proxyQuarantineMs = parseIntegerWithRangeValidation(
    input.proxyQuarantineMs ?? envProxyQuarantineMs,
    "proxyQuarantineMs",
    issues,
    300000,
    1000,
    3600000,
  );

  const fingerprintRotationEnabled = parseBooleanWithValidation(
    input.fingerprintRotationEnabled ?? envFingerprintRotationEnabled,
    "fingerprintRotationEnabled",
    issues,
    true,
  );

  const retryMaxAttempts = parseIntegerWithRangeValidation(
    input.retryMaxAttempts ?? envRetryMaxAttempts,
    "retryMaxAttempts",
    issues,
    3,
    1,
    10,
  );

  const retryBaseDelayMs = parseIntegerWithRangeValidation(
    input.retryBaseDelayMs ?? envRetryBaseDelayMs,
    "retryBaseDelayMs",
    issues,
    200,
    0,
    60000,
  );

  const retryMaxDelayMs = parseIntegerWithRangeValidation(
    input.retryMaxDelayMs ?? envRetryMaxDelayMs,
    "retryMaxDelayMs",
    issues,
    5000,
    0,
    120000,
  );

  const retryBlockedDelayMs = parseIntegerWithRangeValidation(
    input.retryBlockedDelayMs ?? envRetryBlockedDelayMs,
    "retryBlockedDelayMs",
    issues,
    1500,
    0,
    120000,
  );

  const retryJitterMs = parseIntegerWithRangeValidation(
    input.retryJitterMs ?? envRetryJitterMs,
    "retryJitterMs",
    issues,
    250,
    0,
    10000,
  );

  const circuitBreakerEnabled = parseBooleanWithValidation(
    input.circuitBreakerEnabled ?? envCircuitBreakerEnabled,
    "circuitBreakerEnabled",
    issues,
    true,
  );

  const circuitFailureThreshold = parseIntegerWithRangeValidation(
    input.circuitFailureThreshold ?? envCircuitFailureThreshold,
    "circuitFailureThreshold",
    issues,
    5,
    1,
    50,
  );

  const circuitOpenMs = parseIntegerWithRangeValidation(
    input.circuitOpenMs ?? envCircuitOpenMs,
    "circuitOpenMs",
    issues,
    60000,
    1000,
    3600000,
  );

  const circuitHalfOpenSuccessThreshold = parseIntegerWithRangeValidation(
    input.circuitHalfOpenSuccessThreshold ?? envCircuitHalfOpenSuccessThreshold,
    "circuitHalfOpenSuccessThreshold",
    issues,
    2,
    1,
    20,
  );

  const sourceQuarantineMs = parseIntegerWithRangeValidation(
    input.sourceQuarantineMs ?? envSourceQuarantineMs,
    "sourceQuarantineMs",
    issues,
    300000,
    1000,
    3600000,
  );

  const fallbackUrlStrategyEnabled = parseBooleanWithValidation(
    input.fallbackUrlStrategyEnabled ?? envFallbackUrlStrategyEnabled,
    "fallbackUrlStrategyEnabled",
    issues,
    true,
  );

  const checkpointMaxEntries = parseIntegerWithRangeValidation(
    input.checkpointMaxEntries ?? envCheckpointMaxEntries,
    "checkpointMaxEntries",
    issues,
    500,
    50,
    20000,
  );

  const deadLetterEnabled = parseBooleanWithValidation(
    input.deadLetterEnabled ?? envDeadLetterEnabled,
    "deadLetterEnabled",
    issues,
    true,
  );

  const deadLetterStoreName = parseNonEmptyString(
    input.deadLetterStoreName ?? envDeadLetterStoreName,
    "deadLetterStoreName",
    issues,
    "SHADOW_API_DLQ",
  );

  const deadLetterMaxEntries = parseIntegerWithRangeValidation(
    input.deadLetterMaxEntries ?? envDeadLetterMaxEntries,
    "deadLetterMaxEntries",
    issues,
    1000,
    1,
    50000,
  );

  const incidentBlockedSpikeThreshold = parseIntegerWithRangeValidation(
    input.incidentBlockedSpikeThreshold ?? envIncidentBlockedSpikeThreshold,
    "incidentBlockedSpikeThreshold",
    issues,
    5,
    1,
    1000,
  );

  const incidentBlockedSpikeWindowMs = parseIntegerWithRangeValidation(
    input.incidentBlockedSpikeWindowMs ?? envIncidentBlockedSpikeWindowMs,
    "incidentBlockedSpikeWindowMs",
    issues,
    600000,
    1000,
    86400000,
  );

  const incidentWebhookUrlRaw = input.incidentWebhookUrl ?? envIncidentWebhookUrl;
  const incidentWebhookUrl =
    typeof incidentWebhookUrlRaw === "string" && incidentWebhookUrlRaw.trim().length > 0
      ? incidentWebhookUrlRaw.trim()
      : null;

  const shutdownDrainTimeoutMs = parseIntegerWithRangeValidation(
    input.shutdownDrainTimeoutMs ?? envShutdownDrainTimeoutMs,
    "shutdownDrainTimeoutMs",
    issues,
    20000,
    1000,
    600000,
  );

  const mockFetchDelayMs = parseIntegerWithRangeValidation(
    input.mockFetchDelayMs ?? envMockFetchDelayMs,
    "mockFetchDelayMs",
    issues,
    150,
    0,
    60000,
  );

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    host,
    port: parsedPort,
    logLevel,
    apiKeyEnabled,
    apiKey,
    browserPoolEnabled,
    browserPoolSize,
    browserHeadless,
    browserLaunchTimeoutMs,
    standbyEnabled,
    standbyIdleTimeoutMs,
    standbyTickIntervalMs,
    standbyRecycleAfterMs,
    sessionStorageEnabled,
    sessionStoreName,
    sessionStoreKeyPrefix,
    requestQueueConcurrency,
    requestQueueMaxSize,
    requestQueueTaskTimeoutMs,
    fetchTimeoutDefaultMs,
    fetchTimeoutMinMs,
    fetchTimeoutMaxMs,
    requestBodyMaxBytes,
    cacheProvider,
    cacheTtlMs,
    cacheStaleTtlMs,
    cacheSwrEnabled,
    redisUrl,
    redisKeyPrefix,
    fastModeEnabled,
    fastModeMaxFields,
    prewarmEnabled,
    prewarmIntervalMs,
    prewarmTargets,
    browserOptimizedFlagsEnabled,
    browserBlockResources,
    proxyRotationEnabled,
    proxyPoolUrls,
    proxyQuarantineMs,
    fingerprintRotationEnabled,
    retryMaxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    retryBlockedDelayMs,
    retryJitterMs,
    circuitBreakerEnabled,
    circuitFailureThreshold,
    circuitOpenMs,
    circuitHalfOpenSuccessThreshold,
    sourceQuarantineMs,
    fallbackUrlStrategyEnabled,
    checkpointMaxEntries,
    deadLetterEnabled,
    deadLetterStoreName,
    deadLetterMaxEntries,
    incidentBlockedSpikeThreshold,
    incidentBlockedSpikeWindowMs,
    incidentWebhookUrl,
    shutdownDrainTimeoutMs,
    mockFetchDelayMs,
  };
};
