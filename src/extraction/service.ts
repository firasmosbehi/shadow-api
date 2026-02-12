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
import { buildFallbackUrls } from "../reliability/fallback-url-strategy";
import { applyLayoutFallback } from "../reliability/layout-fallback";

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

interface ReliabilityHints {
  proxy?: { id: string; url: string } | null;
  fingerprint?: {
    id: string;
    userAgent: string;
    acceptLanguage: string;
    platform: string;
  } | null;
  fallbackUrls?: string[];
  enableLayoutFallback?: boolean;
  retryAttempt?: number;
  chaos?: {
    scenario?: "timeout" | "network" | "proxy";
    fail_attempts?: number;
  } | null;
}

const parseReliabilityHints = (target: Record<string, unknown>): ReliabilityHints => {
  const raw = target.__reliability;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const hints = raw as Record<string, unknown>;

  const proxyRaw = hints.proxy;
  const proxy =
    proxyRaw && typeof proxyRaw === "object" && !Array.isArray(proxyRaw)
      ? {
          id:
            typeof (proxyRaw as Record<string, unknown>).id === "string"
              ? String((proxyRaw as Record<string, unknown>).id).trim()
              : "",
          url:
            typeof (proxyRaw as Record<string, unknown>).url === "string"
              ? String((proxyRaw as Record<string, unknown>).url).trim()
              : "",
        }
      : null;
  const normalizedProxy = proxy && proxy.id && proxy.url ? proxy : null;

  const fpRaw = hints.fingerprint;
  const fingerprint =
    fpRaw && typeof fpRaw === "object" && !Array.isArray(fpRaw)
      ? {
          id:
            typeof (fpRaw as Record<string, unknown>).id === "string"
              ? String((fpRaw as Record<string, unknown>).id).trim()
              : "",
          userAgent:
            typeof (fpRaw as Record<string, unknown>).userAgent === "string"
              ? String((fpRaw as Record<string, unknown>).userAgent).trim()
              : "",
          acceptLanguage:
            typeof (fpRaw as Record<string, unknown>).acceptLanguage === "string"
              ? String((fpRaw as Record<string, unknown>).acceptLanguage).trim()
              : "en-US,en;q=0.9",
          platform:
            typeof (fpRaw as Record<string, unknown>).platform === "string"
              ? String((fpRaw as Record<string, unknown>).platform).trim()
              : "unknown",
        }
      : null;
  const normalizedFingerprint = fingerprint && fingerprint.id && fingerprint.userAgent ? fingerprint : null;

  const fallbackUrls = Array.isArray(hints.fallback_urls)
    ? hints.fallback_urls
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : undefined;

  const chaosRaw = hints.chaos;
  const chaos =
    chaosRaw && typeof chaosRaw === "object" && !Array.isArray(chaosRaw)
      ? {
          scenario:
            (chaosRaw as Record<string, unknown>).scenario === "timeout" ||
            (chaosRaw as Record<string, unknown>).scenario === "network" ||
            (chaosRaw as Record<string, unknown>).scenario === "proxy"
              ? ((chaosRaw as Record<string, unknown>).scenario as
                  | "timeout"
                  | "network"
                  | "proxy")
              : undefined,
          fail_attempts:
            typeof (chaosRaw as Record<string, unknown>).fail_attempts === "number"
              ? ((chaosRaw as Record<string, unknown>).fail_attempts as number)
              : 1,
        }
      : null;

  return {
    proxy: normalizedProxy,
    fingerprint: normalizedFingerprint,
    fallbackUrls,
    enableLayoutFallback:
      typeof hints.enable_layout_fallback === "boolean"
        ? (hints.enable_layout_fallback as boolean)
        : undefined,
    retryAttempt:
      typeof hints.retry_attempt === "number" && Number.isFinite(hints.retry_attempt)
        ? (hints.retry_attempt as number)
        : undefined,
    chaos,
  };
};

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
  options: {
    proxyUrl?: string | null;
    userAgent?: string;
    acceptLanguage?: string;
    platform?: string;
    attempt: number;
    chaos?: { scenario?: "timeout" | "network" | "proxy"; fail_attempts?: number } | null;
  },
): Promise<{ html: string; statusCode: number }> => {
  if (options.chaos?.scenario && options.attempt <= (options.chaos.fail_attempts ?? 1)) {
    if (options.chaos.scenario === "timeout") {
      throw new ValidationError("Target page fetch timed out.", {
        url,
        timeoutMs,
        chaos: "timeout",
      });
    }
    if (options.chaos.scenario === "network") {
      throw new Error("Synthetic network failure (chaos scenario).");
    }
    if (options.chaos.scenario === "proxy") {
      throw new Error("Synthetic proxy failure (chaos scenario).");
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let dispatcher: unknown = null;
  try {
    if (options.proxyUrl) {
      const undici = (await import("undici")) as unknown as {
        ProxyAgent: new (url: string) => unknown;
      };
      dispatcher = new undici.ProxyAgent(options.proxyUrl);
    }

    const requestInit: RequestInit = {
      signal: controller.signal,
      headers: {
        "user-agent":
          options.userAgent ??
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ShadowAPI/0.1",
        "accept-language": options.acceptLanguage ?? "en-US,en;q=0.9",
        "sec-ch-ua-platform": options.platform ?? "unknown",
        accept: "text/html,application/xhtml+xml",
      },
    };
    if (dispatcher) {
      (requestInit as RequestInit & { dispatcher?: unknown }).dispatcher = dispatcher;
    }

    const response = await fetch(url, requestInit);
    const html = await response.text();
    return { html, statusCode: response.status };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new ValidationError("Target page fetch timed out.", { url, timeoutMs });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (dispatcher && typeof (dispatcher as { close?: () => Promise<void> }).close === "function") {
      try {
        await (dispatcher as { close: () => Promise<void> }).close();
      } catch {
        // ignore dispatcher close errors
      }
    }
  }
};

const isTransientFetchError = (error: unknown): boolean => {
  if (error instanceof SourceBlockedError) return true;
  if (error instanceof ValidationError) {
    const message = error.message.toLowerCase();
    return message.includes("timed out") || message.includes("timeout");
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("fetch failed") ||
      message.includes("proxy")
    );
  }
  return false;
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
    const reliability = parseReliabilityHints(request.target);
    stageLatencyMs.validation_ms = Date.now() - validationStarted;

    try {
      const resolveDocumentStarted = Date.now();
      const document = await this.resolveDocument(source, request.target, timeoutMs, reliability);
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

      const layoutFallbackStarted = Date.now();
      const layoutFallback =
        reliability.enableLayoutFallback === false
          ? { rawData: adapterOutput.rawData, applied: false, notes: [] }
          : applyLayoutFallback(source, operation, document.html, adapterOutput.rawData);
      stageLatencyMs.layout_fallback_ms = Date.now() - layoutFallbackStarted;

      const normalizeStarted = Date.now();
      const normalizedData = normalizeOperation(source, operation, layoutFallback.rawData);
      const unknownFields = findUnknownRequestedFields(normalizedData, request.fields);
      const data = selectRequestedFields(normalizedData, request.fields);
      stageLatencyMs.normalize_ms = Date.now() - normalizeStarted;
      const warnings = [...adapterOutput.warnings];
      if (unknownFields.length > 0) {
        warnings.push(`unknown_requested_fields:${unknownFields.join(",")}`);
      }
      if (layoutFallback.applied) {
        warnings.push(...layoutFallback.notes);
      }

      const latency = Date.now() - started;
      stageLatencyMs.extraction_total_ms = latency;
      this.health.recordSuccess(source, latency);

      return {
        source,
        operation,
        target: request.target,
        data,
        raw: layoutFallback.rawData,
        selector_trace: adapterOutput.selectorTrace,
        warnings,
        pagination: adapterOutput.pagination,
        challenge: null,
        adapter_version: "0.1.0-m6",
        latency_ms: latency,
        stage_latency_ms: stageLatencyMs,
        performance: {
          deduped: false,
          fast_mode: request.fast_mode === true,
          retry_attempt: reliability.retryAttempt ?? 1,
          proxy_id: reliability.proxy?.id ?? null,
          fingerprint_id: reliability.fingerprint?.id ?? null,
        },
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
    reliability: ReliabilityHints,
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

    const primary = deriveTargetUrl(source, target);
    const fallbackCandidates = reliability.fallbackUrls ?? buildFallbackUrls(source, target);
    const candidateUrls =
      fallbackCandidates.length > 0
        ? [...new Set(fallbackCandidates)]
        : primary.url
          ? [primary.url]
          : [];

    if (candidateUrls.length === 0) {
      throw new ValidationError(
        "`target` must include one of: `mockHtml`, `html`, `url`, `handle`, `inviteCode`.",
        { source },
      );
    }

    const errors: string[] = [];
    const capturedErrors: unknown[] = [];
    for (let index = 0; index < candidateUrls.length; index += 1) {
      const url = candidateUrls[index];
      try {
        const fetched = await fetchHtml(url, timeoutMs, {
          attempt: (reliability.retryAttempt ?? 1) + index,
          proxyUrl: reliability.proxy?.url ?? null,
          userAgent: reliability.fingerprint?.userAgent,
          acceptLanguage: reliability.fingerprint?.acceptLanguage,
          platform: reliability.fingerprint?.platform,
          chaos: reliability.chaos ?? null,
        });
        return {
          html: fetched.html,
          url,
          resolvedFrom: index === 0 ? (primary.resolvedFrom ?? "target.url") : "target.url",
          statusCode: fetched.statusCode,
        };
      } catch (error) {
        capturedErrors.push(error);
        errors.push((error as Error).message);
      }
    }

    if (capturedErrors.length > 0 && capturedErrors.every((entry) => isTransientFetchError(entry))) {
      throw capturedErrors[capturedErrors.length - 1];
    }

    throw new ValidationError("Failed to fetch document from fallback URL set.", {
      source,
      candidate_urls: candidateUrls,
      errors,
    });
  }
}
