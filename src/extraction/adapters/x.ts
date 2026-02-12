import { load } from "cheerio";
import { extractHandleFromUrl, readTargetString } from "../adapter-utils";
import { detectPaginationState } from "../pagination";
import { extractWithFallback, type SelectorFieldMap } from "../selector-fallback";
import type { SourceAdapter, AdapterExtractResult } from "../types";

const PROFILE_FIELD_MAP: SelectorFieldMap = {
  display_name: [
    "[data-testid='UserName'] > div > div > span",
    "[data-testid='UserName'] span",
    { selector: "meta[property='og:title']", attribute: "content" },
  ],
  handle: [
    "[data-testid='UserName'] span:nth-child(2)",
    "a[href^='/'] span",
    "[data-field='handle']",
  ],
  bio: [
    "[data-testid='UserDescription']",
    { selector: "meta[property='og:description']", attribute: "content" },
    { selector: "meta[name='description']", attribute: "content" },
  ],
  location: ["[data-testid='UserLocation']", "[data-field='location']"],
  follower_count: [
    "a[href$='/followers'] span",
    "a[href*='/verified_followers'] span",
    "[data-field='followers']",
  ],
  following_count: ["a[href$='/following'] span", "[data-field='following']"],
  post_count: ["a[href$='/with_replies'] span", "[data-field='posts']"],
};

export class XProfileAdapter implements SourceAdapter {
  public readonly source = "x";
  public readonly supportedOperations = ["profile"] as const;

  public async extract(context: {
    operation: string;
    target: Record<string, unknown>;
    document: { html: string; url: string | null };
  }): Promise<AdapterExtractResult> {
    const $ = load(context.document.html);
    const { fields, selectorTrace } = extractWithFallback($, PROFILE_FIELD_MAP);
    const profileUrl = context.document.url ?? readTargetString(context.target, "url");
    const handleFromTarget = readTargetString(context.target, "handle");
    const handleFromSelector = fields.handle;
    const inferredHandle = handleFromTarget ?? handleFromSelector ?? extractHandleFromUrl(profileUrl);

    const pagination = detectPaginationState($, context.document.html, {
      nextLinkSelectors: ["a[rel='next']", "a[href*='cursor=']"],
      loadMoreSelectors: ["button[data-testid='primaryColumn']", "button[aria-label*='Show more']"],
      cursorRegex: /cursor=([a-z0-9%_\-.]+)/i,
    });

    const warnings: string[] = [];
    if (!fields.display_name) warnings.push("x.display_name_not_found");
    if (!fields.bio) warnings.push("x.bio_not_found");

    return {
      rawData: {
        ...fields,
        handle: inferredHandle,
        profile_url: profileUrl,
      },
      selectorTrace: {
        ...selectorTrace,
        handle: handleFromTarget
          ? "target.handle"
          : handleFromSelector
            ? selectorTrace.handle
            : inferredHandle
              ? "inferred:url"
              : null,
        profile_url: profileUrl ? "target.url|resolved" : null,
      },
      warnings,
      pagination,
    };
  }
}
