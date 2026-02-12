import { load } from "cheerio";
import type { SupportedSource } from "../extraction/types";

export interface LayoutFallbackResult {
  rawData: Record<string, unknown>;
  applied: boolean;
  notes: string[];
}

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const fill = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  notes: string[],
  note: string,
): void => {
  if (asText(target[key])) return;
  const normalized = asText(value);
  if (!normalized) return;
  target[key] = normalized;
  notes.push(note);
};

const meta = ($: ReturnType<typeof load>, selector: string): string | null => {
  const value = $(selector).first().attr("content");
  return asText(value);
};

const fromJsonLd = (html: string): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const scriptMatches = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scriptMatches) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        for (const [key, value] of Object.entries(obj)) {
          if (!(key in result)) result[key] = value;
        }
      }
    } catch {
      // ignore malformed json-ld
    }
  }
  return result;
};

export const applyLayoutFallback = (
  source: SupportedSource,
  operation: string,
  html: string,
  rawData: Record<string, unknown>,
): LayoutFallbackResult => {
  const notes: string[] = [];
  const data = { ...rawData };
  const $ = load(html);
  const jsonLd = fromJsonLd(html);

  if (source === "linkedin" && operation === "profile") {
    fill(data, "full_name", meta($, "meta[property='og:title']"), notes, "layout_fallback:linkedin:og:title");
    fill(
      data,
      "headline",
      meta($, "meta[property='og:description']"),
      notes,
      "layout_fallback:linkedin:og:description",
    );
    fill(data, "full_name", jsonLd.name, notes, "layout_fallback:linkedin:jsonld:name");
    fill(data, "profile_url", meta($, "meta[property='og:url']"), notes, "layout_fallback:linkedin:og:url");
  }

  if (source === "x" && operation === "profile") {
    fill(data, "display_name", meta($, "meta[property='og:title']"), notes, "layout_fallback:x:og:title");
    fill(data, "bio", meta($, "meta[property='og:description']"), notes, "layout_fallback:x:og:description");
    fill(data, "profile_url", meta($, "meta[property='og:url']"), notes, "layout_fallback:x:og:url");
    fill(data, "display_name", jsonLd.name, notes, "layout_fallback:x:jsonld:name");
  }

  if (source === "discord" && operation === "server_metadata") {
    fill(data, "server_name", meta($, "meta[property='og:title']"), notes, "layout_fallback:discord:og:title");
    fill(
      data,
      "description",
      meta($, "meta[property='og:description']"),
      notes,
      "layout_fallback:discord:og:description",
    );
    fill(data, "server_name", jsonLd.name, notes, "layout_fallback:discord:jsonld:name");
  }

  return {
    rawData: data,
    applied: notes.length > 0,
    notes,
  };
};
