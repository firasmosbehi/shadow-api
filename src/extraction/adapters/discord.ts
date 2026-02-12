import { load } from "cheerio";
import { firstRegexMatch, readTargetString } from "../adapter-utils";
import { detectPaginationState } from "../pagination";
import { extractWithFallback, type SelectorFieldMap } from "../selector-fallback";
import type { SourceAdapter, AdapterExtractResult } from "../types";

const SERVER_FIELD_MAP: SelectorFieldMap = {
  server_name: [
    { selector: "meta[property='og:title']", attribute: "content" },
    { selector: "meta[name='twitter:title']", attribute: "content" },
    "h1",
    "[data-field='server-name']",
  ],
  description: [
    { selector: "meta[property='og:description']", attribute: "content" },
    { selector: "meta[name='description']", attribute: "content" },
    "[data-field='description']",
    "main p",
  ],
};

const extractInviteCode = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const maybeCode = segments.at(-1);
    return maybeCode ? maybeCode.toLowerCase() : null;
  } catch {
    return null;
  }
};

export class DiscordServerMetadataAdapter implements SourceAdapter {
  public readonly source = "discord";
  public readonly supportedOperations = ["server_metadata"] as const;

  public async extract(context: {
    operation: string;
    target: Record<string, unknown>;
    document: { html: string; url: string | null };
  }): Promise<AdapterExtractResult> {
    const $ = load(context.document.html);
    const { fields, selectorTrace } = extractWithFallback($, SERVER_FIELD_MAP);

    const members = firstRegexMatch(context.document.html, [
      /([0-9][0-9,.\s]*[kmb]?)\s+members?/i,
      /members?\D+([0-9][0-9,.\s]*[kmb]?)/i,
    ]);
    const online = firstRegexMatch(context.document.html, [
      /([0-9][0-9,.\s]*[kmb]?)\s+online/i,
      /online\D+([0-9][0-9,.\s]*[kmb]?)/i,
    ]);

    const inviteUrl = context.document.url ?? readTargetString(context.target, "url");
    const inviteFromTarget = readTargetString(context.target, "inviteCode");
    const inviteCode = inviteFromTarget ?? extractInviteCode(inviteUrl);

    const pagination = detectPaginationState($, context.document.html, {
      nextLinkSelectors: ["a[rel='next']", "a[href*='cursor=']"],
      loadMoreSelectors: ["button[aria-label*='more']", "button[data-testid='load-more']"],
      cursorRegex: /cursor=([a-z0-9_-]+)/i,
    });

    const warnings: string[] = [];
    if (!fields.server_name) warnings.push("discord.server_name_not_found");

    return {
      rawData: {
        ...fields,
        invite_url: inviteUrl,
        invite_code: inviteCode,
        member_count: members.value,
        online_count: online.value,
      },
      selectorTrace: {
        ...selectorTrace,
        member_count: members.trace,
        online_count: online.trace,
        invite_code: inviteFromTarget ? "target.inviteCode" : inviteCode ? "inferred:url" : null,
        invite_url: inviteUrl ? "target.url|resolved" : null,
      },
      warnings,
      pagination,
    };
  }
}
