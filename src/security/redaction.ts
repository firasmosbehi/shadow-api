const DEFAULT_REDACTED = "[REDACTED]";

const SENSITIVE_KEYWORDS = [
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "pass",
  "token",
  "secret",
  "hmac",
  "redisurl",
  "proxy",
  "session",
] as const;

const hasSensitiveKey = (key: string): boolean => {
  const normalized = key.trim().toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const redactBearer = (value: string): string =>
  value.replace(/(bearer)\s+([a-z0-9._~+/=-]+)/gi, "$1 [REDACTED]");

const redactUrlCredentials = (value: string): string => {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = "REDACTED";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
};

const maybeRedactString = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^bearer\s+/i.test(trimmed)) return redactBearer(trimmed);
  if (/^https?:\/\//i.test(trimmed)) return redactUrlCredentials(trimmed);
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface RedactionOptions {
  maxDepth?: number;
  redactedValue?: string;
}

export const redact = (value: unknown, options: RedactionOptions = {}): unknown => {
  const maxDepth = Math.max(1, options.maxDepth ?? 6);
  const redactedValue = options.redactedValue ?? DEFAULT_REDACTED;

  const walk = (input: unknown, depth: number): unknown => {
    if (depth > maxDepth) return "[TRUNCATED]";
    if (input === null || input === undefined) return input;

    if (typeof input === "string") {
      return maybeRedactString(input);
    }

    if (typeof input === "number" || typeof input === "boolean") return input;

    if (Array.isArray(input)) {
      return input.map((entry) => walk(entry, depth + 1));
    }

    if (isRecord(input)) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(input)) {
        if (hasSensitiveKey(key)) {
          out[key] = redactedValue;
          continue;
        }
        out[key] = walk(entry, depth + 1);
      }
      return out;
    }

    // Fallback: preserve shape but avoid leaking stringification surprises.
    try {
      return JSON.parse(JSON.stringify(input)) as unknown;
    } catch {
      return String(input);
    }
  };

  return walk(value, 0);
};

