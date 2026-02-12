import {
  OperationNotSupportedError,
  SourceNotSupportedError,
  ValidationError,
} from "../runtime/errors";
import type { SupportedSource } from "./types";

const asTrimmed = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const toHttpsUrl = (value: unknown): string | null => {
  const raw = asTrimmed(value);
  if (!raw) return null;

  const tryParse = (candidate: string): string | null => {
    try {
      const parsed = new URL(candidate);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  };

  return tryParse(raw) ?? tryParse(`https://${raw}`);
};

export const normalizeHandle = (value: unknown): string | null => {
  const raw = asTrimmed(value);
  if (!raw) return null;
  return raw.replace(/^@+/, "").trim().toLowerCase() || null;
};

export const parseHumanCount = (value: unknown): number | null => {
  const raw = asTrimmed(value);
  if (!raw) return null;

  const compact = raw.replace(/,/g, "").toLowerCase();
  const match = compact.match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/);
  if (!match) return null;

  const base = Number.parseFloat(match[1]);
  if (Number.isNaN(base)) return null;

  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : 1;

  return Math.round(base * multiplier);
};

export const selectRequestedFields = (
  data: Record<string, unknown>,
  fields?: string[],
): Record<string, unknown> => {
  if (!fields || fields.length === 0) return data;

  const requested = fields.map((entry) => entry.trim()).filter(Boolean);
  if (requested.length === 0) return data;

  const selected: Record<string, unknown> = {};
  for (const key of requested) {
    selected[key] = key in data ? data[key] : null;
  }
  return selected;
};

export const findUnknownRequestedFields = (
  data: Record<string, unknown>,
  fields?: string[],
): string[] => {
  if (!fields || fields.length === 0) return [];
  const known = new Set(Object.keys(data));
  return fields
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !known.has(entry));
};

const normalizeLinkedInProfile = (raw: Record<string, unknown>): Record<string, unknown> => ({
  full_name: asTrimmed(raw.full_name ?? raw.name),
  headline: asTrimmed(raw.headline),
  location: asTrimmed(raw.location),
  about: asTrimmed(raw.about),
  handle: normalizeHandle(raw.handle),
  profile_url: toHttpsUrl(raw.profile_url),
  follower_count: parseHumanCount(raw.follower_count),
});

const normalizeXProfile = (raw: Record<string, unknown>): Record<string, unknown> => ({
  display_name: asTrimmed(raw.display_name ?? raw.name),
  handle: normalizeHandle(raw.handle),
  profile_url: toHttpsUrl(raw.profile_url),
  bio: asTrimmed(raw.bio),
  location: asTrimmed(raw.location),
  follower_count: parseHumanCount(raw.follower_count),
  following_count: parseHumanCount(raw.following_count),
  post_count: parseHumanCount(raw.post_count),
});

const normalizeDiscordServerMetadata = (raw: Record<string, unknown>): Record<string, unknown> => ({
  server_name: asTrimmed(raw.server_name),
  description: asTrimmed(raw.description),
  invite_code: normalizeHandle(raw.invite_code),
  invite_url: toHttpsUrl(raw.invite_url),
  member_count: parseHumanCount(raw.member_count),
  online_count: parseHumanCount(raw.online_count),
});

export const normalizeOperation = (
  source: SupportedSource,
  operation: string,
  rawData: Record<string, unknown>,
): Record<string, unknown> => {
  if (source === "linkedin") {
    if (operation !== "profile") {
      throw new OperationNotSupportedError(source, operation, ["profile"]);
    }
    return normalizeLinkedInProfile(rawData);
  }

  if (source === "x") {
    if (operation !== "profile") {
      throw new OperationNotSupportedError(source, operation, ["profile"]);
    }
    return normalizeXProfile(rawData);
  }

  if (source === "discord") {
    if (operation !== "server_metadata") {
      throw new OperationNotSupportedError(source, operation, ["server_metadata"]);
    }
    return normalizeDiscordServerMetadata(rawData);
  }

  throw new SourceNotSupportedError(source);
};

export const normalizeSourceKey = (source: string): SupportedSource => {
  const normalized = source.trim().toLowerCase();
  if (normalized === "linkedin") return "linkedin";
  if (normalized === "x" || normalized === "twitter") return "x";
  if (normalized === "discord") return "discord";
  throw new SourceNotSupportedError(source);
};

export const normalizeOperationKey = (operation: string): string => {
  const normalized = operation.trim().toLowerCase();
  if (!normalized) {
    throw new ValidationError("`operation` is required and must be a non-empty string.");
  }
  return normalized;
};
