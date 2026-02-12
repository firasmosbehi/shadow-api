import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { SignatureInvalidError, SignatureRequiredError } from "../runtime/errors";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const hmacSha256Hex = (secret: string, value: string): string =>
  createHmac("sha256", secret).update(value, "utf8").digest("hex");

const safeEqual = (a: string, b: string): boolean => {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
};

export interface HmacSigningConfig {
  enabled: boolean;
  secrets: string[];
  maxSkewSec: number;
  signatureHeader: string;
  timestampHeader: string;
}

export const verifyRequestSignature = (
  config: HmacSigningConfig,
  req: IncomingMessage,
  pathWithQuery: string,
  rawBody: string,
): void => {
  if (!config.enabled) return;

  const rawSig = req.headers[config.signatureHeader.toLowerCase()];
  const rawTs = req.headers[config.timestampHeader.toLowerCase()];

  const signature = typeof rawSig === "string" ? rawSig.trim() : "";
  const timestampRaw = typeof rawTs === "string" ? rawTs.trim() : "";

  if (!signature || !timestampRaw) {
    throw new SignatureRequiredError({
      acceptedHeaders: [config.signatureHeader, config.timestampHeader],
    });
  }

  const timestampSec = Number(timestampRaw);
  if (!Number.isFinite(timestampSec) || !Number.isInteger(timestampSec)) {
    throw new SignatureInvalidError("Invalid signature timestamp.", {
      header: config.timestampHeader,
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const skew = Math.abs(nowSec - timestampSec);
  if (skew > config.maxSkewSec) {
    throw new SignatureInvalidError("Signature timestamp outside allowed window.", {
      skew_sec: skew,
      max_skew_sec: config.maxSkewSec,
    });
  }

  if (!Array.isArray(config.secrets) || config.secrets.length === 0) {
    throw new SignatureInvalidError("Signature verification is enabled but secrets are missing.");
  }

  const method = (req.method ?? "GET").toUpperCase();
  const bodyHash = sha256Hex(rawBody ?? "");
  const canonical = `${timestampSec}.${method}.${pathWithQuery}.${bodyHash}`;

  for (const secret of config.secrets) {
    const expected = hmacSha256Hex(secret, canonical);
    if (safeEqual(expected, signature)) return;
  }

  throw new SignatureInvalidError("Signature mismatch.", {
    signature_header: config.signatureHeader,
    timestamp_header: config.timestampHeader,
  });
};

