import { log } from "apify";

export interface IncidentEvent {
  id: string;
  level: "warning" | "critical";
  kind: "blocked_spike" | "circuit_open" | "dead_letter" | "proxy_quarantined" | "source_quarantined";
  source: string;
  message: string;
  details: Record<string, unknown> | null;
  timestamp: string;
}

export interface IncidentReporterSnapshot {
  total_events: number;
  blocked_events_last_10m: Record<string, number>;
  recent: IncidentEvent[];
  webhook_enabled: boolean;
}

export interface IncidentReporterConfig {
  blockedSpikeThreshold: number;
  blockedSpikeWindowMs: number;
  webhookUrl: string | null;
  maxRecentEvents: number;
}

interface BlockedMarker {
  source: string;
  at: number;
}

export class IncidentReporter {
  private readonly config: IncidentReporterConfig;
  private readonly blockedMarkers: BlockedMarker[] = [];
  private readonly events: IncidentEvent[] = [];

  public constructor(config: IncidentReporterConfig) {
    this.config = config;
  }

  public async reportBlocked(source: string, details?: Record<string, unknown>): Promise<void> {
    this.blockedMarkers.push({ source, at: Date.now() });
    this.pruneBlockedMarkers();

    const recentCount = this.blockedMarkers.filter((entry) => entry.source === source).length;
    if (recentCount >= this.config.blockedSpikeThreshold) {
      await this.emit({
        level: "critical",
        kind: "blocked_spike",
        source,
        message: `Blocked spike detected for source '${source}'.`,
        details: {
          recent_count: recentCount,
          threshold: this.config.blockedSpikeThreshold,
          ...details,
        },
      });
    }
  }

  public async reportEvent(event: Omit<IncidentEvent, "id" | "timestamp">): Promise<void> {
    await this.emit(event);
  }

  public snapshot(): IncidentReporterSnapshot {
    this.pruneBlockedMarkers();
    const blockedEventsLast10m: Record<string, number> = {};
    for (const marker of this.blockedMarkers) {
      blockedEventsLast10m[marker.source] = (blockedEventsLast10m[marker.source] ?? 0) + 1;
    }

    return {
      total_events: this.events.length,
      blocked_events_last_10m: blockedEventsLast10m,
      recent: this.events.slice(-Math.max(1, this.config.maxRecentEvents)),
      webhook_enabled: Boolean(this.config.webhookUrl),
    };
  }

  private async emit(event: Omit<IncidentEvent, "id" | "timestamp">): Promise<void> {
    const incident: IncidentEvent = {
      ...event,
      id: `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.events.push(incident);
    if (this.events.length > this.config.maxRecentEvents * 5) {
      this.events.splice(0, this.events.length - this.config.maxRecentEvents * 5);
    }

    if (incident.level === "critical") {
      log.error("Reliability incident", incident);
    } else {
      log.warning("Reliability incident", incident);
    }

    if (!this.config.webhookUrl) return;
    try {
      await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(incident),
      });
    } catch (error) {
      log.warning("Failed sending incident webhook.", {
        error: (error as Error).message,
      });
    }
  }

  private pruneBlockedMarkers(): void {
    const cutoff = Date.now() - this.config.blockedSpikeWindowMs;
    while (this.blockedMarkers.length > 0 && this.blockedMarkers[0].at < cutoff) {
      this.blockedMarkers.shift();
    }
  }
}
