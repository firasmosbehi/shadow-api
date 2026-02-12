import { log } from "apify";
import type { Browser, BrowserContext, Page } from "playwright-core";

export interface BrowserPoolConfig {
  enabled: boolean;
  size: number;
  headless: boolean;
  launchTimeoutMs: number;
}

interface WarmSession {
  id: string;
  createdAt: number;
  lastWarmedAt: number;
  context: BrowserContext;
  page: Page;
}

export interface BrowserPoolStatus {
  enabled: boolean;
  browserReady: boolean;
  configuredSize: number;
  warmSessionCount: number;
  lastWarmAt: string | null;
}

export class BrowserPoolManager {
  private readonly config: BrowserPoolConfig;
  private browser: Browser | null = null;
  private sessions: WarmSession[] = [];
  private running = false;
  private lastWarmAt: number | null = null;

  public constructor(config: BrowserPoolConfig) {
    this.config = config;
  }

  public async start(): Promise<void> {
    this.running = true;
    if (!this.config.enabled) {
      log.warning("Browser pool is disabled by configuration.");
      return;
    }

    await this.ensureBrowser();
    await this.ensureWarmSessions(this.config.size);
  }

  public async stop(): Promise<void> {
    this.running = false;
    await this.closeAllSessions();
    await this.closeBrowser();
  }

  public getStatus(): BrowserPoolStatus {
    return {
      enabled: this.config.enabled,
      browserReady: this.browser !== null,
      configuredSize: this.config.size,
      warmSessionCount: this.sessions.length,
      lastWarmAt: this.lastWarmAt ? new Date(this.lastWarmAt).toISOString() : null,
    };
  }

  public async ensureWarmSessions(targetSize: number): Promise<void> {
    if (!this.config.enabled || !this.running) return;
    await this.ensureBrowser();

    while (this.sessions.length < targetSize) {
      const session = await this.createSession();
      this.sessions.push(session);
      log.debug("Warm browser session created", { sessionId: session.id });
    }
  }

  public async shrinkTo(targetSize: number): Promise<void> {
    if (!this.config.enabled) return;
    while (this.sessions.length > targetSize) {
      const session = this.sessions.pop();
      if (!session) break;
      await this.closeSession(session);
      log.debug("Warm browser session closed", { sessionId: session.id });
    }
  }

  public async warmAll(): Promise<void> {
    if (!this.config.enabled || this.sessions.length === 0) return;
    for (const session of this.sessions) {
      try {
        await session.page.goto("about:blank", { timeout: this.config.launchTimeoutMs });
        session.lastWarmedAt = Date.now();
      } catch (error) {
        log.warning("Warm session refresh failed; recreating session.", {
          sessionId: session.id,
          error: (error as Error).message,
        });
        await this.replaceSession(session.id);
      }
    }
    this.lastWarmAt = Date.now();
  }

  public async recycleStale(maxAgeMs: number): Promise<void> {
    if (!this.config.enabled || maxAgeMs <= 0) return;
    const now = Date.now();
    const staleIds = this.sessions
      .filter((session) => now - session.createdAt >= maxAgeMs)
      .map((session) => session.id);

    for (const staleId of staleIds) {
      await this.replaceSession(staleId);
      log.debug("Warm session recycled", { sessionId: staleId, maxAgeMs });
    }
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser) return;

    const { chromium } = await import("playwright-core");
    this.browser = await chromium.launch({
      headless: this.config.headless,
      timeout: this.config.launchTimeoutMs,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    log.info("Browser pool launched Playwright browser.", {
      headless: this.config.headless,
      launchTimeoutMs: this.config.launchTimeoutMs,
    });
  }

  private async createSession(): Promise<WarmSession> {
    if (!this.browser) {
      throw new Error("Browser is not initialized.");
    }

    const context = await this.browser.newContext();
    const page = await context.newPage();
    await page.goto("about:blank", { timeout: this.config.launchTimeoutMs });

    const now = Date.now();
    return {
      id: `session_${now}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      lastWarmedAt: now,
      context,
      page,
    };
  }

  private async replaceSession(sessionId: string): Promise<void> {
    const index = this.sessions.findIndex((entry) => entry.id === sessionId);
    if (index < 0) return;

    const oldSession = this.sessions[index];
    await this.closeSession(oldSession);
    const newSession = await this.createSession();
    this.sessions[index] = newSession;
  }

  private async closeAllSessions(): Promise<void> {
    const sessions = [...this.sessions];
    this.sessions = [];
    for (const session of sessions) {
      await this.closeSession(session);
    }
  }

  private async closeSession(session: WarmSession): Promise<void> {
    await session.context.close().catch((error: unknown) => {
      log.warning("Failed closing browser context.", {
        sessionId: session.id,
        error: (error as Error).message,
      });
    });
  }

  private async closeBrowser(): Promise<void> {
    if (!this.browser) return;
    const browser = this.browser;
    this.browser = null;
    await browser.close().catch((error: unknown) => {
      log.warning("Failed closing Playwright browser.", {
        error: (error as Error).message,
      });
    });
  }
}
