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

export const buildRuntimeConfig = (input: ActorInput): RuntimeConfig => {
  const issues: string[] = [];

  const envHost = process.env.HOST;
  const envPort = process.env.PORT;
  const envLogLevel = process.env.LOG_LEVEL;
  const envRequiredEnvVars = process.env.REQUIRED_ENV_VARS;
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

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    host,
    port: parsedPort,
    logLevel,
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
  };
};
