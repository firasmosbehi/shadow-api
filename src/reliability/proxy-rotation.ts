export interface ProxyEndpoint {
  id: string;
  url: string;
  successes: number;
  failures: number;
  blocked: number;
  last_used_at: string | null;
  quarantined_until: string | null;
  last_error: string | null;
}

export interface ProxyRotationSnapshot {
  enabled: boolean;
  total: number;
  healthy: number;
  quarantined: number;
  endpoints: ProxyEndpoint[];
}

interface ProxyState {
  id: string;
  url: string;
  successes: number;
  failures: number;
  blocked: number;
  lastUsedAt: number | null;
  quarantinedUntil: number | null;
  lastError: string | null;
}

export interface ProxyRotationConfig {
  enabled: boolean;
  proxyUrls: string[];
  quarantineMs: number;
}

export class RotatingProxyPool {
  private readonly enabled: boolean;
  private readonly quarantineMs: number;
  private readonly proxies: ProxyState[];

  public constructor(config: ProxyRotationConfig) {
    this.enabled = config.enabled;
    this.quarantineMs = config.quarantineMs;
    this.proxies = config.proxyUrls.map((url, index) => ({
      id: `proxy_${index + 1}`,
      url,
      successes: 0,
      failures: 0,
      blocked: 0,
      lastUsedAt: null,
      quarantinedUntil: null,
      lastError: null,
    }));
  }

  public next(): { id: string; url: string } | null {
    if (!this.enabled || this.proxies.length === 0) return null;
    const now = Date.now();

    const eligible = this.proxies
      .filter((entry) => !entry.quarantinedUntil || now >= entry.quarantinedUntil)
      .sort((a, b) => {
        const aUsed = a.lastUsedAt ?? 0;
        const bUsed = b.lastUsedAt ?? 0;
        if (aUsed !== bUsed) return aUsed - bUsed;
        return (a.failures - a.successes) - (b.failures - b.successes);
      });

    const picked = eligible[0];
    if (!picked) return null;
    picked.lastUsedAt = now;
    return { id: picked.id, url: picked.url };
  }

  public reportSuccess(proxyId: string): void {
    const proxy = this.find(proxyId);
    if (!proxy) return;
    proxy.successes += 1;
    proxy.lastError = null;
  }

  public reportFailure(proxyId: string, params: { blocked?: boolean; error?: string } = {}): void {
    const proxy = this.find(proxyId);
    if (!proxy) return;
    proxy.failures += 1;
    proxy.lastError = params.error ?? "unknown";
    if (params.blocked) {
      proxy.blocked += 1;
      proxy.quarantinedUntil = Date.now() + this.quarantineMs;
    }
  }

  public snapshot(): ProxyRotationSnapshot {
    const now = Date.now();
    const endpoints: ProxyEndpoint[] = this.proxies.map((entry) => ({
      id: entry.id,
      url: entry.url,
      successes: entry.successes,
      failures: entry.failures,
      blocked: entry.blocked,
      last_used_at: entry.lastUsedAt ? new Date(entry.lastUsedAt).toISOString() : null,
      quarantined_until:
        entry.quarantinedUntil && entry.quarantinedUntil > now
          ? new Date(entry.quarantinedUntil).toISOString()
          : null,
      last_error: entry.lastError,
    }));

    const healthy = endpoints.filter((entry) => !entry.quarantined_until).length;
    return {
      enabled: this.enabled,
      total: endpoints.length,
      healthy,
      quarantined: endpoints.length - healthy,
      endpoints,
    };
  }

  private find(id: string): ProxyState | undefined {
    return this.proxies.find((entry) => entry.id === id);
  }
}
