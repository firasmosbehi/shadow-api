import type { SupportedSource } from "../extraction/types";

const normalizeHandle = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@+/, "");
  return normalized.length > 0 ? normalized : null;
};

const normalizeUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeInviteCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    output.push(item);
  }
  return output;
};

export const buildFallbackUrls = (
  source: SupportedSource,
  target: Record<string, unknown>,
): string[] => {
  const explicitUrl = normalizeUrl(target.url);
  if (source === "linkedin") {
    const handle = normalizeHandle(target.handle);
    const candidates = [
      explicitUrl,
      handle ? `https://www.linkedin.com/in/${encodeURIComponent(handle)}` : null,
      handle ? `https://www.linkedin.com/pub/${encodeURIComponent(handle)}` : null,
    ].filter((entry): entry is string => Boolean(entry));
    return dedupe(candidates);
  }

  if (source === "x") {
    const handle = normalizeHandle(target.handle);
    const candidates = [
      explicitUrl,
      handle ? `https://x.com/${encodeURIComponent(handle)}` : null,
      handle ? `https://twitter.com/${encodeURIComponent(handle)}` : null,
      handle ? `https://mobile.twitter.com/${encodeURIComponent(handle)}` : null,
    ].filter((entry): entry is string => Boolean(entry));
    return dedupe(candidates);
  }

  if (source === "discord") {
    const inviteCode = normalizeInviteCode(target.inviteCode);
    const candidates = [
      explicitUrl,
      inviteCode ? `https://discord.com/invite/${encodeURIComponent(inviteCode)}` : null,
      inviteCode ? `https://discord.gg/${encodeURIComponent(inviteCode)}` : null,
    ].filter((entry): entry is string => Boolean(entry));
    return dedupe(candidates);
  }

  return explicitUrl ? [explicitUrl] : [];
};
