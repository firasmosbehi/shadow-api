import { log } from "apify";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { SessionStorageManager } from "./session-storage";

export interface BrowserPoolConfig {
  enabled: boolean;
  size: number;
  headless: boolean;
  launchTimeoutMs: number;
  sessionStorage: SessionStorageManager;
}

interface WarmSession {
  id: string;
  slot: number;
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
  persistedSessionEnabled: boolean;
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
    const sessionStorageStatus = this.config.sessionStorage.getStatus();
    return {
      enabled: this.config.enabled,
      browserReady: this.browser !== null,
      configuredSize: this.config.size,
      warmSessionCount: this.sessions.length,
      persistedSessionEnabled: sessionStorageStatus.enabled,
      lastWarmAt: this.lastWarmAt ? new Date(this.lastWarmAt).toISOString() : null,
    };
  }

  public async ensureWarmSessions(targetSize: number): Promise<void> {
    if (!this.config.enabled || !this.running) return;
    await this.ensureBrowser();

    for (let slot = 0; slot < targetSize; slot += 1) {
      if (this.sessions.some((session) => session.slot === slot)) continue;
      const session = await this.createSession(slot);
      this.sessions.push(session);
      log.debug("Warm browser session created", { sessionId: session.id, slot });
    }
    this.sessions.sort((a, b) => a.slot - b.slot);
  }

  public async shrinkTo(targetSize: number): Promise<void> {
    if (!this.config.enabled) return;
    const staleSessions = this.sessions
      .filter((session) => session.slot >= targetSize)
      .sort((a, b) => b.slot - a.slot);

    for (const session of staleSessions) {
      this.sessions = this.sessions.filter((entry) => entry.id !== session.id);
      await this.closeSession(session);
      log.debug("Warm browser session closed", { sessionId: session.id, slot: session.slot });
    }
  }

  public async warmAll(): Promise<void> {
    if (!this.config.enabled || this.sessions.length === 0) return;
    for (const session of this.sessions) {
      try {
        await session.page.goto("about:blank", { timeout: this.config.launchTimeoutMs });
        session.lastWarmedAt = Date.now();
        await this.persistSession(session);
      } catch (error) {
        log.warning("Warm session refresh failed; recreating session.", {
          sessionId: session.id,
          slot: session.slot,
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

  private async createSession(slot: number): Promise<WarmSession> {
    if (!this.browser) {
      throw new Error("Browser is not initialized.");
    }

    const persistedState = await this.config.sessionStorage.load(slot);
    const context = await this.browser.newContext(
      persistedState ? { storageState: persistedState } : undefined,
    );
    const page = await context.newPage();
    await page.goto("about:blank", { timeout: this.config.launchTimeoutMs });

    const now = Date.now();
    const session: WarmSession = {
      id: `session_${now}_${Math.random().toString(36).slice(2, 8)}`,
      slot,
      createdAt: now,
      lastWarmedAt: now,
      context,
      page,
    };
    await this.persistSession(session);
    return session;
  }

  private async replaceSession(sessionId: string): Promise<void> {
    const index = this.sessions.findIndex((entry) => entry.id === sessionId);
    if (index < 0) return;

    const oldSession = this.sessions[index];
    await this.closeSession(oldSession);
    const newSession = await this.createSession(oldSession.slot);
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
    await this.persistSession(session);
    await session.context.close().catch((error: unknown) => {
      log.warning("Failed closing browser context.", {
        sessionId: session.id,
        slot: session.slot,
        error: (error as Error).message,
      });
    });
  }

  private async persistSession(session: WarmSession): Promise<void> {
    try {
      const state = await session.context.storageState();
      await this.config.sessionStorage.save(session.slot, state);
    } catch (error) {
      log.warning("Failed persisting session storage state.", {
        sessionId: session.id,
        slot: session.slot,
        error: (error as Error).message,
      });
    }
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
