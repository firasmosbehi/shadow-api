import { config as loadDotEnv } from "dotenv";
import type { ActorInput, RuntimeConfig } from "./types";

loadDotEnv();

const toNumber = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toLogLevel = (
  raw: string | undefined,
  fallback: RuntimeConfig["logLevel"],
): RuntimeConfig["logLevel"] => {
  const value = (raw ?? fallback).toUpperCase();
  if (value === "DEBUG" || value === "INFO" || value === "WARNING" || value === "ERROR") {
    return value;
  }
  return fallback;
};

export const buildRuntimeConfig = (input: ActorInput): RuntimeConfig => {
  const envHost = process.env.HOST;
  const envPort = process.env.PORT;
  const envLogLevel = process.env.LOG_LEVEL;

  return {
    host: input.host ?? envHost ?? "0.0.0.0",
    port: input.port ?? toNumber(envPort, 3000),
    logLevel: toLogLevel(input.logLevel ?? envLogLevel, "INFO"),
  };
};
