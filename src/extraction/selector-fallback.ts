import type { CheerioAPI } from "cheerio";

export interface SelectorFallbackResult {
  value: string | null;
  selector: string | null;
}

export interface SelectorCandidate {
  selector: string;
  attribute?: string;
}

export type SelectorFieldMap = Record<string, Array<string | SelectorCandidate>>;

const normalizeCandidate = (candidate: string | SelectorCandidate): SelectorCandidate =>
  typeof candidate === "string" ? { selector: candidate } : candidate;

const valueFromCandidate = (
  $: CheerioAPI,
  candidate: SelectorCandidate,
): string | null => {
  const node = $(candidate.selector).first();
  if (node.length === 0) return null;

  const raw =
    typeof candidate.attribute === "string"
      ? node.attr(candidate.attribute)
      : node.text();
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > 0 ? value : null;
};

export const pickFirstText = (
  $: CheerioAPI,
  selectors: Array<string | SelectorCandidate>,
): SelectorFallbackResult => {
  for (const candidateInput of selectors) {
    const candidate = normalizeCandidate(candidateInput);
    const value = valueFromCandidate($, candidate);
    if (value) {
      return { value, selector: candidate.selector };
    }
  }
  return { value: null, selector: null };
};

export interface ExtractWithFallbackOutput {
  fields: Record<string, string | null>;
  selectorTrace: Record<string, string | null>;
}

export const extractWithFallback = (
  $: CheerioAPI,
  map: SelectorFieldMap,
): ExtractWithFallbackOutput => {
  const fields: Record<string, string | null> = {};
  const selectorTrace: Record<string, string | null> = {};

  for (const [field, selectors] of Object.entries(map)) {
    const result = pickFirstText($, selectors);
    fields[field] = result.value;
    selectorTrace[field] = result.selector;
  }

  return { fields, selectorTrace };
};
