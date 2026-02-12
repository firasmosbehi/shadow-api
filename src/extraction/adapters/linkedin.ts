import { load } from "cheerio";
import { readTargetString, extractHandleFromUrl } from "../adapter-utils";
import { detectPaginationState } from "../pagination";
import { extractWithFallback, type SelectorFieldMap } from "../selector-fallback";
import type { SourceAdapter, AdapterExtractResult } from "../types";

const PROFILE_FIELD_MAP: SelectorFieldMap = {
  full_name: ["h1", ".text-heading-xlarge", "main h1"],
  headline: [
    ".text-body-medium.break-words",
    ".pv-text-details__left-panel .text-body-medium",
    "[data-field='headline']",
  ],
  location: [
    ".text-body-small.inline.t-black--light.break-words",
    ".pv-text-details__left-panel .text-body-small",
  ],
  about: ["section#about p", "section.pv-about-section p", "[data-field='about']"],
  follower_count: [
    "a[href*='followers'] span",
    ".pv-recent-activity-section__follower-count",
    "[data-field='followers']",
  ],
};

export class LinkedInProfileAdapter implements SourceAdapter {
  public readonly source = "linkedin";
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
    const inferredHandle = handleFromTarget ?? extractHandleFromUrl(profileUrl);

    const pagination = detectPaginationState($, context.document.html, {
      nextLinkSelectors: ["a[rel='next']", "a[href*='start=']"],
      loadMoreSelectors: ["button[aria-label*='Show more']", "button.artdeco-button"],
      cursorRegex: /start=([0-9]+)/i,
    });

    const warnings: string[] = [];
    if (!fields.full_name) warnings.push("linkedin.full_name_not_found");
    if (!fields.headline) warnings.push("linkedin.headline_not_found");

    return {
      rawData: {
        ...fields,
        handle: inferredHandle,
        profile_url: profileUrl,
      },
      selectorTrace: {
        ...selectorTrace,
        handle: handleFromTarget ? "target.handle" : inferredHandle ? "inferred:url" : null,
        profile_url: profileUrl ? "target.url|resolved" : null,
      },
      warnings,
      pagination,
    };
  }
}
