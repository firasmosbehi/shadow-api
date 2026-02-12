import { AppError } from "../runtime/errors";

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type RetryCategory =
  | "blocked"
  | "timeout"
  | "network"
  | "circuit"
  | "validation"
  | "non_retryable"
  | "internal";

export interface AdaptiveRetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  blockedDelayMs: number;
  jitterMs: number;
}

export interface RetryDecision {
  retry: boolean;
  category: RetryCategory;
  delayMs: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const classifyRetryCategory = (error: unknown): RetryCategory => {
  if (error instanceof AppError) {
    if (error.code === "SOURCE_BLOCKED" || error.code === "SOURCE_QUARANTINED") return "blocked";
    if (error.code === "QUEUE_TIMEOUT") return "timeout";
    if (error.code === "CIRCUIT_OPEN") return "circuit";
    if (error.code === "VALIDATION_ERROR") {
      const message = error.message.toLowerCase();
      if (message.includes("timed out") || message.includes("timeout")) return "timeout";
      return "validation";
    }
    if (error.code === "INTERNAL_ERROR") {
      const message = error.message.toLowerCase();
      if (message.includes("timed out") || message.includes("timeout")) return "timeout";
      if (
        message.includes("network") ||
        message.includes("econnreset") ||
        message.includes("econnrefused") ||
        message.includes("enotfound") ||
        message.includes("fetch failed")
      ) {
        return "network";
      }
      return "internal";
    }
    if (error.retryable) return "internal";
    return "non_retryable";
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("timed out")) return "timeout";
    if (
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("fetch failed")
    ) {
      return "network";
    }
  }

  return "internal";
};

const computeDelay = (
  config: AdaptiveRetryConfig,
  category: RetryCategory,
  attempt: number,
): number => {
  const exp = Math.max(0, attempt - 1);
  const base =
    category === "blocked"
      ? config.blockedDelayMs
      : config.baseDelayMs * Math.pow(2, exp);
  const jitter = Math.floor(Math.random() * config.jitterMs);
  return clamp(base + jitter, 0, config.maxDelayMs);
};

export const decideRetry = (
  config: AdaptiveRetryConfig,
  error: unknown,
  attempt: number,
): RetryDecision => {
  const category = classifyRetryCategory(error);
  const maxAttempts = Math.max(1, config.maxAttempts);
  const canRetry =
    attempt < maxAttempts &&
    (category === "timeout" ||
      category === "network" ||
      category === "blocked" ||
      category === "internal");

  return {
    retry: canRetry,
    category,
    delayMs: canRetry ? computeDelay(config, category, attempt) : 0,
  };
};

export interface RetryAttemptContext {
  attempt: number;
  maxAttempts: number;
  category: RetryCategory;
  delayMs: number;
  error: unknown;
}

export const executeWithAdaptiveRetry = async <T>(
  config: AdaptiveRetryConfig,
  run: (attempt: number) => Promise<T>,
  hooks: {
    onRetry?: (ctx: RetryAttemptContext) => Promise<void> | void;
    onFinalFailure?: (ctx: RetryAttemptContext) => Promise<void> | void;
  } = {},
): Promise<T> => {
  let attempt = 1;
  const maxAttempts = Math.max(1, config.maxAttempts);
  while (attempt <= maxAttempts) {
    try {
      return await run(attempt);
    } catch (error) {
      const decision = decideRetry(config, error, attempt);
      if (!decision.retry) {
        if (hooks.onFinalFailure) {
          await hooks.onFinalFailure({
            attempt,
            maxAttempts,
            category: decision.category,
            delayMs: decision.delayMs,
            error,
          });
        }
        throw error;
      }

      if (hooks.onRetry) {
        await hooks.onRetry({
          attempt,
          maxAttempts,
          category: decision.category,
          delayMs: decision.delayMs,
          error,
        });
      }
      if (decision.delayMs > 0) {
        await sleep(decision.delayMs);
      }
      attempt += 1;
    }
  }

  throw new Error("Retry loop exited unexpectedly.");
};
