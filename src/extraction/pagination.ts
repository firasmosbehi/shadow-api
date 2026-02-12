import type { CheerioAPI } from "cheerio";
import type { PaginationState } from "./types";

export interface PaginationDetectionOptions {
  nextLinkSelectors?: string[];
  loadMoreSelectors?: string[];
  cursorRegex?: RegExp;
}

const DEFAULT_NEXT_LINK_SELECTORS = ["a[rel='next']", "a[aria-label='Next']", "a.next"];
const DEFAULT_LOAD_MORE_SELECTORS = [
  "button[aria-label*='Show more']",
  "button[data-testid='primaryColumn']",
  "button.load-more",
];

const normalizeCursor = (value: string | null): string | null => {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const cursorFromUrl = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://shadow-api.local");
    const cursor = parsed.searchParams.get("cursor") ?? parsed.searchParams.get("start");
    return normalizeCursor(cursor);
  } catch {
    return null;
  }
};

export const detectPaginationState = (
  $: CheerioAPI,
  html: string,
  options: PaginationDetectionOptions = {},
): PaginationState => {
  const evidence: string[] = [];
  const nextSelectors = options.nextLinkSelectors ?? DEFAULT_NEXT_LINK_SELECTORS;
  const loadMoreSelectors = options.loadMoreSelectors ?? DEFAULT_LOAD_MORE_SELECTORS;
  const cursorRegex = options.cursorRegex ?? /(?:cursor|start)=([a-z0-9_-]+)/i;

  let nextUrl: string | null = null;
  for (const selector of nextSelectors) {
    const href = $(selector).first().attr("href");
    if (typeof href === "string" && href.trim().length > 0) {
      nextUrl = href.trim();
      evidence.push(`next-link:${selector}`);
      break;
    }
  }

  let cursor = cursorFromUrl(nextUrl);
  if (!cursor) {
    const match = html.match(cursorRegex);
    cursor = normalizeCursor(match?.[1] ?? null);
    if (cursor) evidence.push("cursor-regex");
  }

  let hasInfiniteScroll = false;
  for (const selector of loadMoreSelectors) {
    if ($(selector).length > 0) {
      hasInfiniteScroll = true;
      evidence.push(`infinite-scroll:${selector}`);
      break;
    }
  }

  const hasMore = Boolean(nextUrl || cursor || hasInfiniteScroll);
  let strategy: PaginationState["strategy"] = "none";
  if (nextUrl) strategy = "next_link";
  else if (cursor) strategy = "cursor";
  else if (hasInfiniteScroll) strategy = "infinite_scroll";

  return {
    has_more: hasMore,
    next_url: nextUrl,
    cursor,
    strategy,
    evidence,
  };
};

export const mergePaginatedItems = <T>(
  current: T[],
  incoming: T[],
  keySelector: (value: T) => string,
): T[] => {
  const dedup = new Map<string, T>();

  for (const entry of current) dedup.set(keySelector(entry), entry);
  for (const entry of incoming) dedup.set(keySelector(entry), entry);

  return [...dedup.values()];
};
