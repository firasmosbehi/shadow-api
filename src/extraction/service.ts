import { randomUUID } from "node:crypto";
import {
  OperationNotSupportedError,
  SourceBlockedError,
  SourceNotSupportedError,
  ValidationError,
} from "../runtime/errors";
import { createDefaultAdapters } from "./adapters";
import { detectChallengeSignals } from "./challenge-detection";
import { AdapterHealthTracker } from "./health-tracker";
import {
  findUnknownRequestedFields,
  normalizeOperation,
  normalizeOperationKey,
  normalizeSourceKey,
  selectRequestedFields,
} from "./normalization";
import type {
  AdapterHealthSnapshot,
  ExtractionDocument,
  ExtractionResult,
  FetchRequestInput,
  SourceAdapter,
  SupportedSource,
} from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (target: Record<string, unknown>, key: string): string | null => {
  const value = target[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeHandle = (raw: string): string => raw.trim().replace(/^@+/, "");

const deriveTargetUrl = (source: SupportedSource, target: Record<string, unknown>): {
  url: string | null;
  resolvedFrom: ExtractionDocument["resolvedFrom"] | null;
} => {
  const explicitUrl = readString(target, "url");
  if (explicitUrl) return { url: explicitUrl, resolvedFrom: "target.url" };

  if (source === "linkedin") {
    const handle = readString(target, "handle");
    if (handle) {
      return {
        url: `https://www.linkedin.com/in/${encodeURIComponent(normalizeHandle(handle))}`,
        resolvedFrom: "target.handle",
      };
    }
  }

  if (source === "x") {
    const handle = readString(target, "handle");
    if (handle) {
      return {
        url: `https://x.com/${encodeURIComponent(normalizeHandle(handle))}`,
        resolvedFrom: "target.handle",
      };
    }
  }

  if (source === "discord") {
    const inviteCode = readString(target, "inviteCode");
    if (inviteCode) {
      return {
        url: `https://discord.com/invite/${encodeURIComponent(inviteCode)}`,
        resolvedFrom: "target.inviteCode",
      };
    }
  }

  return { url: null, resolvedFrom: null };
};

const fetchHtml = async (
  url: string,
  timeoutMs: number,
): Promise<{ html: string; statusCode: number }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ShadowAPI/0.1",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await response.text();
    return { html, statusCode: response.status };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new ValidationError("Target page fetch timed out.", { url, timeoutMs });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export interface ExtractionServiceConfig {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  adapters?: SourceAdapter[];
}

export class ExtractionService {
  private readonly adapterMap: Map<SupportedSource, SourceAdapter>;
  private readonly health: AdapterHealthTracker;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;

  public constructor(config: ExtractionServiceConfig) {
    const adapters = config.adapters ?? createDefaultAdapters();
    this.adapterMap = new Map(adapters.map((adapter) => [adapter.source, adapter]));
    this.health = new AdapterHealthTracker(adapters.map((adapter) => adapter.source));
    this.defaultTimeoutMs = config.defaultTimeoutMs;
    this.maxTimeoutMs = config.maxTimeoutMs;
  }

  public getAdapterHealth(): AdapterHealthSnapshot[] {
    return this.health.snapshot();
  }

  public async execute(request: FetchRequestInput): Promise<ExtractionResult> {
    const started = Date.now();
    const requestId = randomUUID();
    const stageLatencyMs: Record<string, number> = {};

    const validationStarted = Date.now();
    const source = normalizeSourceKey(request.source);
    const operation = normalizeOperationKey(request.operation);
    const adapter = this.adapterMap.get(source);
    if (!adapter) {
      throw new SourceNotSupportedError(source);
    }
    if (!adapter.supportedOperations.includes(operation)) {
      throw new OperationNotSupportedError(source, operation, [...adapter.supportedOperations]);
    }
    if (!isRecord(request.target)) {
      throw new ValidationError("`target` is required and must be an object.");
    }

    const timeoutMs = clamp(
      typeof request.timeout_ms === "number" && Number.isFinite(request.timeout_ms)
        ? request.timeout_ms
        : this.defaultTimeoutMs,
      1000,
      this.maxTimeoutMs,
    );
    stageLatencyMs.validation_ms = Date.now() - validationStarted;

    try {
      const resolveDocumentStarted = Date.now();
      const document = await this.resolveDocument(source, request.target, timeoutMs);
      stageLatencyMs.resolve_document_ms = Date.now() - resolveDocumentStarted;

      const challengeStarted = Date.now();
      const challenge = detectChallengeSignals({
        html: document.html,
        url: document.url,
        statusCode: document.statusCode,
      });
      stageLatencyMs.challenge_detection_ms = Date.now() - challengeStarted;

      if (challenge.blocked) {
        this.health.recordFailure(source, {
          blocked: true,
          latencyMs: Date.now() - started,
        });
        throw new SourceBlockedError(`Source challenge detected for '${source}'.`, {
          source,
          operation,
          challenge,
          requestId,
          stage_latency_ms: stageLatencyMs,
        });
      }

      const adapterExtractStarted = Date.now();
      const adapterOutput = await adapter.extract({
        operation,
        target: request.target,
        fields: request.fields,
        timeoutMs,
        document,
      });
      stageLatencyMs.adapter_extract_ms = Date.now() - adapterExtractStarted;

      const normalizeStarted = Date.now();
      const normalizedData = normalizeOperation(source, operation, adapterOutput.rawData);
      const unknownFields = findUnknownRequestedFields(normalizedData, request.fields);
      const data = selectRequestedFields(normalizedData, request.fields);
      stageLatencyMs.normalize_ms = Date.now() - normalizeStarted;
      const warnings = [...adapterOutput.warnings];
      if (unknownFields.length > 0) {
        warnings.push(`unknown_requested_fields:${unknownFields.join(",")}`);
      }

      const latency = Date.now() - started;
      stageLatencyMs.extraction_total_ms = latency;
      this.health.recordSuccess(source, latency);

      return {
        source,
        operation,
        target: request.target,
        data,
        raw: adapterOutput.rawData,
        selector_trace: adapterOutput.selectorTrace,
        warnings,
        pagination: adapterOutput.pagination,
        challenge: null,
        adapter_version: "0.1.0-m5",
        latency_ms: latency,
        stage_latency_ms: stageLatencyMs,
        fetched_at: new Date().toISOString(),
      };
    } catch (error) {
      if (!(error instanceof SourceBlockedError)) {
        this.health.recordFailure(source, {
          blocked: false,
          latencyMs: Date.now() - started,
        });
      }
      throw error;
    }
  }

  private async resolveDocument(
    source: SupportedSource,
    target: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<ExtractionDocument> {
    const mockHtml = readString(target, "mockHtml");
    if (mockHtml) {
      return {
        html: mockHtml,
        url: readString(target, "url"),
        resolvedFrom: "target.mockHtml",
        statusCode: 200,
      };
    }

    const inlineHtml = readString(target, "html");
    if (inlineHtml) {
      return {
        html: inlineHtml,
        url: readString(target, "url"),
        resolvedFrom: "target.html",
        statusCode: 200,
      };
    }

    const { url, resolvedFrom } = deriveTargetUrl(source, target);
    if (!url || !resolvedFrom) {
      throw new ValidationError(
        "`target` must include one of: `mockHtml`, `html`, `url`, `handle`, `inviteCode`.",
        { source },
      );
    }

    const fetched = await fetchHtml(url, timeoutMs);
    return {
      html: fetched.html,
      url,
      resolvedFrom,
      statusCode: fetched.statusCode,
    };
  }
}
