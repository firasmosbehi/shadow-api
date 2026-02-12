import { config as loadDotEnv } from "dotenv";
import type { ActorInput, RuntimeConfig } from "./types";

loadDotEnv();

const ALLOWED_LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"] as const;

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

export const buildRuntimeConfig = (input: ActorInput): RuntimeConfig => {
  const issues: string[] = [];

  const envHost = process.env.HOST;
  const envPort = process.env.PORT;
  const envLogLevel = process.env.LOG_LEVEL;
  const envRequiredEnvVars = process.env.REQUIRED_ENV_VARS;

  const rawHost = input.host ?? envHost ?? "0.0.0.0";
  const host = typeof rawHost === "string" ? rawHost.trim() : "";
  if (!host) {
    issues.push("`host` must be a non-empty string (input `host` or env `HOST`).");
  }

  const rawPort = input.port ?? envPort ?? 3000;
  const parsedPort =
    typeof rawPort === "number"
      ? rawPort
      : typeof rawPort === "string"
        ? Number(rawPort)
        : Number.NaN;

  if (!Number.isInteger(parsedPort)) {
    issues.push(
      `\`port\` must be an integer. Received: ${JSON.stringify(rawPort)} (input \`port\` or env \`PORT\`).`,
    );
  } else if (parsedPort < 1 || parsedPort > 65535) {
    issues.push(
      `\`port\` must be within 1-65535. Received: ${parsedPort} (input \`port\` or env \`PORT\`).`,
    );
  }

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

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    host,
    port: parsedPort,
    logLevel,
  };
};
