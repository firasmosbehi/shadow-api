import type { CheerioAPI } from "cheerio";

export const readTargetString = (
  target: Record<string, unknown>,
  key: string,
): string | null => {
  const value = target[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const extractHandleFromUrl = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (!last) return null;
    return last.replace(/^@+/, "").toLowerCase();
  } catch {
    return null;
  }
};

export const firstRegexMatch = (
  html: string,
  patterns: RegExp[],
): { value: string | null; trace: string | null } => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return {
        value,
        trace: `regex:${pattern.source}`,
      };
    }
  }
  return { value: null, trace: null };
};

export const readMetaContent = (
  $: CheerioAPI,
  nameOrProperty: string,
): string | null => {
  const fromProperty = $(`meta[property='${nameOrProperty}']`).first().attr("content");
  if (typeof fromProperty === "string" && fromProperty.trim().length > 0) {
    return fromProperty.trim();
  }

  const fromName = $(`meta[name='${nameOrProperty}']`).first().attr("content");
  if (typeof fromName === "string" && fromName.trim().length > 0) {
    return fromName.trim();
  }

  return null;
};
