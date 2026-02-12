import type { Page } from "playwright-core";
import { NavigationError } from "./errors";

export interface NavigateOptions {
  attempts?: number;
  timeoutMs?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  backoffMs?: number;
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const navigateWithRetry = async (
  page: Page,
  url: string,
  options: NavigateOptions = {},
): Promise<void> => {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  const waitUntil = options.waitUntil ?? "domcontentloaded";
  const backoffMs = options.backoffMs ?? 300;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { timeout: timeoutMs, waitUntil });
      return;
    } catch (error) {
      lastError = error as Error;
      if (attempt < attempts) {
        await sleep(backoffMs * attempt);
      }
    }
  }

  throw new NavigationError("Navigation failed after retries.", {
    url,
    attempts,
    timeoutMs,
    lastError: lastError?.message ?? null,
  });
};

export const waitForAnySelector = async (
  page: Page,
  selectors: string[],
  timeoutMs = 7000,
): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const handle = await page.$(selector);
      if (handle) {
        await handle.dispose();
        return selector;
      }
    }
    await sleep(100);
  }

  throw new NavigationError("None of the expected selectors appeared before timeout.", {
    selectors,
    timeoutMs,
  });
};

export const waitForPageReady = async (
  page: Page,
  options: { selectors?: string[]; timeoutMs?: number } = {},
): Promise<void> => {
  const timeoutMs = options.timeoutMs ?? 10000;
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  if (options.selectors && options.selectors.length > 0) {
    await waitForAnySelector(page, options.selectors, timeoutMs);
  }
};
