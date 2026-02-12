import { CircuitOpenError } from "../runtime/errors";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerSnapshot {
  source: string;
  state: CircuitState;
  consecutive_failures: number;
  opened_at: string | null;
  open_until: string | null;
  last_failure_at: string | null;
  last_success_at: string | null;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  openMs: number;
  halfOpenSuccessThreshold: number;
}

interface CircuitStateInternal {
  source: string;
  state: CircuitState;
  consecutiveFailures: number;
  halfOpenSuccesses: number;
  openedAt: number | null;
  openUntil: number | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
}

export class CircuitBreakerRegistry {
  private readonly config: CircuitBreakerConfig;
  private readonly circuits = new Map<string, CircuitStateInternal>();

  public constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  public assertCanExecute(source: string): void {
    if (!this.config.enabled) return;
    const circuit = this.ensure(source);
    this.maybeTransitionFromOpen(circuit);
    if (circuit.state === "open") {
      throw new CircuitOpenError(source, {
        source,
        open_until: circuit.openUntil ? new Date(circuit.openUntil).toISOString() : null,
        failure_threshold: this.config.failureThreshold,
      });
    }
  }

  public recordSuccess(source: string): void {
    if (!this.config.enabled) return;
    const circuit = this.ensure(source);
    circuit.lastSuccessAt = Date.now();

    if (circuit.state === "half_open") {
      circuit.halfOpenSuccesses += 1;
      if (circuit.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.reset(circuit);
      }
      return;
    }

    this.reset(circuit);
  }

  public recordFailure(source: string, params: { blocked?: boolean } = {}): void {
    if (!this.config.enabled) return;
    const circuit = this.ensure(source);
    circuit.lastFailureAt = Date.now();
    circuit.consecutiveFailures += params.blocked ? 2 : 1;

    if (circuit.state === "half_open") {
      this.open(circuit);
      return;
    }

    if (circuit.consecutiveFailures >= this.config.failureThreshold) {
      this.open(circuit);
    }
  }

  public snapshot(): CircuitBreakerSnapshot[] {
    const now = Date.now();
    return [...this.circuits.values()]
      .map((entry) => {
        this.maybeTransitionFromOpen(entry);
        return {
          source: entry.source,
          state: entry.state,
          consecutive_failures: entry.consecutiveFailures,
          opened_at: entry.openedAt ? new Date(entry.openedAt).toISOString() : null,
          open_until:
            entry.openUntil && entry.openUntil > now
              ? new Date(entry.openUntil).toISOString()
              : null,
          last_failure_at: entry.lastFailureAt ? new Date(entry.lastFailureAt).toISOString() : null,
          last_success_at: entry.lastSuccessAt ? new Date(entry.lastSuccessAt).toISOString() : null,
        };
      })
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  private ensure(source: string): CircuitStateInternal {
    const key = source.trim().toLowerCase();
    const existing = this.circuits.get(key);
    if (existing) return existing;

    const created: CircuitStateInternal = {
      source: key,
      state: "closed",
      consecutiveFailures: 0,
      halfOpenSuccesses: 0,
      openedAt: null,
      openUntil: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    };
    this.circuits.set(key, created);
    return created;
  }

  private maybeTransitionFromOpen(circuit: CircuitStateInternal): void {
    if (circuit.state !== "open") return;
    if (!circuit.openUntil) return;
    if (Date.now() < circuit.openUntil) return;

    circuit.state = "half_open";
    circuit.halfOpenSuccesses = 0;
  }

  private open(circuit: CircuitStateInternal): void {
    circuit.state = "open";
    circuit.openedAt = Date.now();
    circuit.openUntil = circuit.openedAt + this.config.openMs;
    circuit.halfOpenSuccesses = 0;
  }

  private reset(circuit: CircuitStateInternal): void {
    circuit.state = "closed";
    circuit.consecutiveFailures = 0;
    circuit.halfOpenSuccesses = 0;
    circuit.openedAt = null;
    circuit.openUntil = null;
  }
}
