export type SupportedSource = "linkedin" | "x" | "discord";

export interface FetchRequestInput {
  source: string;
  operation: string;
  target: Record<string, unknown>;
  fields?: string[];
  freshness?: string;
  timeout_ms?: number;
}

export interface ExtractionDocument {
  html: string;
  url: string | null;
  resolvedFrom:
    | "target.mockHtml"
    | "target.html"
    | "target.url"
    | "target.handle"
    | "target.inviteCode";
  statusCode: number | null;
}

export interface PaginationState {
  has_more: boolean;
  next_url: string | null;
  cursor: string | null;
  strategy: "none" | "next_link" | "cursor" | "infinite_scroll";
  evidence: string[];
}

export interface ChallengeDetectionResult {
  blocked: boolean;
  kind: "captcha" | "rate_limit" | "login_wall" | "bot_check" | "unknown" | null;
  confidence: number;
  evidence: string[];
}

export interface AdapterExtractContext {
  operation: string;
  target: Record<string, unknown>;
  fields?: string[];
  timeoutMs: number;
  document: ExtractionDocument;
}

export interface AdapterExtractResult {
  rawData: Record<string, unknown>;
  selectorTrace: Record<string, string | null>;
  warnings: string[];
  pagination: PaginationState | null;
}

export interface SourceAdapter {
  source: SupportedSource;
  supportedOperations: readonly string[];
  extract(context: AdapterExtractContext): Promise<AdapterExtractResult>;
}

export interface ExtractionResult {
  source: SupportedSource;
  operation: string;
  target: Record<string, unknown>;
  data: Record<string, unknown>;
  raw: Record<string, unknown>;
  selector_trace: Record<string, string | null>;
  warnings: string[];
  pagination: PaginationState | null;
  challenge: ChallengeDetectionResult | null;
  adapter_version: string;
  latency_ms: number;
  fetched_at: string;
}

export interface AdapterHealthSnapshot {
  source: string;
  total_requests: number;
  success_count: number;
  failure_count: number;
  blocked_count: number;
  success_rate: number;
  blocked_rate: number;
  avg_latency_ms: number;
  score: number;
  status: "warming" | "healthy" | "degraded" | "unhealthy";
  last_success_at: string | null;
  last_failure_at: string | null;
  last_blocked_at: string | null;
}
