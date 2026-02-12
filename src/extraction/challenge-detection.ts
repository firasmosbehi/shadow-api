import type { ChallengeDetectionResult } from "./types";

interface PatternRule {
  kind: NonNullable<ChallengeDetectionResult["kind"]>;
  regex: RegExp;
  evidence: string;
}

const PATTERNS: PatternRule[] = [
  {
    kind: "captcha",
    regex: /\b(captcha|hcaptcha|recaptcha|please verify you are human)\b/i,
    evidence: "captcha marker",
  },
  {
    kind: "rate_limit",
    regex: /\b(too many requests|rate limit|temporarily blocked)\b/i,
    evidence: "rate limit marker",
  },
  {
    kind: "login_wall",
    regex: /\b(sign in to continue|log in to continue|join linkedin|create an account)\b/i,
    evidence: "login wall marker",
  },
  {
    kind: "bot_check",
    regex: /\b(verify your identity|security check|unusual traffic|are you a robot)\b/i,
    evidence: "bot-check marker",
  },
];

const pushIfMissing = (target: string[], value: string): void => {
  if (!target.includes(value)) target.push(value);
};

export const detectChallengeSignals = (params: {
  html: string;
  url?: string | null;
  statusCode?: number | null;
}): ChallengeDetectionResult => {
  const evidence: string[] = [];
  const kindCounts = new Map<NonNullable<ChallengeDetectionResult["kind"]>, number>();
  const html = params.html.slice(0, 120_000);

  for (const rule of PATTERNS) {
    if (rule.regex.test(html)) {
      pushIfMissing(evidence, rule.evidence);
      kindCounts.set(rule.kind, (kindCounts.get(rule.kind) ?? 0) + 1);
    }
  }

  if (params.statusCode === 403 || params.statusCode === 429) {
    pushIfMissing(evidence, `http-status-${params.statusCode}`);
    kindCounts.set(
      params.statusCode === 429 ? "rate_limit" : "bot_check",
      (kindCounts.get(params.statusCode === 429 ? "rate_limit" : "bot_check") ?? 0) + 1,
    );
  }

  if (typeof params.url === "string") {
    const lowerUrl = params.url.toLowerCase();
    if (lowerUrl.includes("captcha") || lowerUrl.includes("challenge")) {
      pushIfMissing(evidence, "challenge-url");
      kindCounts.set("captcha", (kindCounts.get("captcha") ?? 0) + 1);
    }
  }

  let dominantKind: ChallengeDetectionResult["kind"] = null;
  let highest = 0;
  for (const [kind, count] of kindCounts.entries()) {
    if (count > highest) {
      highest = count;
      dominantKind = kind;
    }
  }

  const blocked = evidence.length > 0;
  const confidence = blocked ? Math.min(1, 0.35 + evidence.length * 0.2) : 0;

  return {
    blocked,
    kind: blocked ? dominantKind ?? "unknown" : null,
    confidence,
    evidence,
  };
};
