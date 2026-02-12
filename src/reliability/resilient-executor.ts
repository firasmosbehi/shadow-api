import { normalizeError } from "../runtime/errors";
import type { ExtractionService } from "../extraction/service";
import type { ExtractionResult, FetchRequestInput } from "../extraction/types";
import { CircuitBreakerRegistry } from "./circuit-breaker";
import { CheckpointStore } from "./checkpoint-store";
import { DeadLetterQueue } from "./dead-letter-queue";
import { FingerprintRotator } from "./fingerprint-rotation";
import { IncidentReporter } from "./incident-reporter";
import { RotatingProxyPool } from "./proxy-rotation";
import { QuarantineRegistry } from "./quarantine";
import type { AdaptiveRetryConfig } from "./retry-policy";
import { executeWithAdaptiveRetry } from "./retry-policy";

export interface ResilientExecutorConfig {
  extractionService: ExtractionService;
  retryConfig: AdaptiveRetryConfig;
  circuitBreakers: CircuitBreakerRegistry;
  proxyPool: RotatingProxyPool;
  fingerprintRotator: FingerprintRotator;
  quarantine: QuarantineRegistry;
  checkpointStore: CheckpointStore;
  deadLetterQueue: DeadLetterQueue;
  incidentReporter: IncidentReporter;
  sourceQuarantineMs: number;
  proxyQuarantineMs: number;
  fallbackUrlStrategyEnabled: boolean;
}

export interface ReliabilitySnapshot {
  circuits: ReturnType<CircuitBreakerRegistry["snapshot"]>;
  proxies: ReturnType<RotatingProxyPool["snapshot"]>;
  fingerprints: ReturnType<FingerprintRotator["snapshot"]>;
  quarantine: ReturnType<QuarantineRegistry["snapshot"]>;
  checkpoints: ReturnType<CheckpointStore["snapshot"]>;
  dead_letters: ReturnType<DeadLetterQueue["snapshotSync"]>;
  incidents: ReturnType<IncidentReporter["snapshot"]>;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export class ResilientExecutor {
  private readonly config: ResilientExecutorConfig;

  public constructor(config: ResilientExecutorConfig) {
    this.config = config;
  }

  public snapshot(): ReliabilitySnapshot {
    return {
      circuits: this.config.circuitBreakers.snapshot(),
      proxies: this.config.proxyPool.snapshot(),
      fingerprints: this.config.fingerprintRotator.snapshot(),
      quarantine: this.config.quarantine.snapshot(),
      checkpoints: this.config.checkpointStore.snapshot(),
      dead_letters: this.config.deadLetterQueue.snapshotSync(),
      incidents: this.config.incidentReporter.snapshot(),
    };
  }

  public async execute(request: FetchRequestInput): Promise<ExtractionResult> {
    const source = request.source.trim().toLowerCase();
    const operation = request.operation.trim().toLowerCase();
    const requestId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.config.checkpointStore.start(requestId, source, operation);
    this.config.checkpointStore.stage(requestId, "received", {
      source,
      operation,
    });

    let selectedProxy = this.config.proxyPool.next();
    let selectedFingerprint = this.config.fingerprintRotator.next();

    const runAttempt = async (attempt: number): Promise<ExtractionResult> => {
      this.config.checkpointStore.stage(requestId, "attempt_start", {
        attempt,
        proxy_id: selectedProxy?.id ?? null,
        fingerprint_id: selectedFingerprint.id,
      });
      this.config.quarantine.assertSourceReady(source);
      this.config.circuitBreakers.assertCanExecute(source);

      const enrichedTarget = {
        ...request.target,
        __reliability: {
          proxy: selectedProxy,
          fingerprint: selectedFingerprint,
          enable_layout_fallback: true,
          retry_attempt: attempt,
          fallback_urls: this.config.fallbackUrlStrategyEnabled ? undefined : [],
          chaos: asRecord(request.target).chaos ?? undefined,
        },
      };

      try {
        const result = await this.config.extractionService.execute({
          ...request,
          target: enrichedTarget,
        });

        this.config.circuitBreakers.recordSuccess(source);
        if (selectedProxy) this.config.proxyPool.reportSuccess(selectedProxy.id);
        this.config.checkpointStore.stage(requestId, "attempt_success", {
          attempt,
          latency_ms: result.latency_ms,
        });
        return {
          ...result,
          performance: {
            ...(result.performance ?? { deduped: false, fast_mode: request.fast_mode === true }),
            retry_attempt: attempt,
            proxy_id: selectedProxy?.id ?? null,
            fingerprint_id: selectedFingerprint.id,
          },
        };
      } catch (error) {
        const appError = normalizeError(error);
        const blocked =
          appError.code === "SOURCE_BLOCKED" || appError.code === "SOURCE_QUARANTINED";

        this.config.circuitBreakers.recordFailure(source, { blocked });
        if (selectedProxy) {
          this.config.proxyPool.reportFailure(selectedProxy.id, {
            blocked,
            error: appError.message,
          });
        }
        if (blocked) {
          this.config.quarantine.quarantineSource(
            source,
            "blocked-signal",
            this.config.sourceQuarantineMs,
            { code: appError.code, attempt },
          );
          if (selectedProxy) {
            this.config.quarantine.quarantineProxy(
              selectedProxy.id,
              "blocked-signal",
              this.config.proxyQuarantineMs,
              { code: appError.code, attempt },
            );
          }
          this.config.fingerprintRotator.reportBlocked(selectedFingerprint.id);
          await this.config.incidentReporter.reportBlocked(source, {
            code: appError.code,
            proxy_id: selectedProxy?.id ?? null,
            fingerprint_id: selectedFingerprint.id,
            attempt,
          });
        }

        this.config.checkpointStore.stage(requestId, "attempt_failure", {
          attempt,
          code: appError.code,
          message: appError.message,
        });

        selectedProxy = this.config.proxyPool.next();
        selectedFingerprint = this.config.fingerprintRotator.next();
        throw appError;
      }
    };

    try {
      const result = await executeWithAdaptiveRetry(this.config.retryConfig, runAttempt, {
        onRetry: async (ctx) => {
          this.config.checkpointStore.stage(requestId, "retry_scheduled", {
            attempt: ctx.attempt,
            category: ctx.category,
            delay_ms: ctx.delayMs,
          });
        },
        onFinalFailure: async (ctx) => {
          const appError = normalizeError(ctx.error);
          this.config.checkpointStore.stage(requestId, "retry_exhausted", {
            attempt: ctx.attempt,
            category: ctx.category,
            code: appError.code,
          });
        },
      });
      this.config.checkpointStore.succeed(requestId, {
        latency_ms: result.latency_ms,
      });
      return result;
    } catch (error) {
      const appError = normalizeError(error);
      this.config.checkpointStore.fail(requestId, {
        code: appError.code,
        message: appError.message,
        details: appError.details ?? null,
      });

      const deadLetter = await this.config.deadLetterQueue.push({
        source,
        operation,
        request: {
          ...request,
        },
        error: {
          code: appError.code,
          message: appError.message,
          retryable: appError.retryable,
          details: appError.details,
        },
        context: {
          request_id: requestId,
          proxy_id: selectedProxy?.id ?? null,
          fingerprint_id: selectedFingerprint.id,
        },
      });

      if (deadLetter) {
        await this.config.incidentReporter.reportEvent({
          level: "warning",
          kind: "dead_letter",
          source,
          message: "Request moved to dead-letter queue after retry exhaustion.",
          details: {
            dead_letter_id: deadLetter.id,
            code: appError.code,
          },
        });
      }

      throw appError;
    }
  }
}
