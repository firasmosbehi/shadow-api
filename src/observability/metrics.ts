type LabelValue = string | number | boolean | null | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const escapeLabel = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const normalizeLabels = (labels: Record<string, LabelValue> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
};

const formatLabels = (labels: Record<string, string>): string => {
  const keys = Object.keys(labels).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) return "";
  const inner = keys.map((key) => `${key}="${escapeLabel(labels[key])}"`).join(",");
  return `{${inner}}`;
};

const keyFor = (name: string, labels: Record<string, string>): string =>
  `${name}|${Object.keys(labels)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => `${k}=${labels[k]}`)
    .join(",")}`;

interface HistogramState {
  buckets: number[];
  bucketCounts: number[];
  sum: number;
  count: number;
}

const DEFAULT_MS_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000];

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();

  public inc(name: string, labels: Record<string, LabelValue> = {}, value = 1): void {
    const normalized = normalizeLabels(labels);
    const key = keyFor(name, normalized);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  public observeMs(name: string, labels: Record<string, LabelValue> = {}, valueMs: number): void {
    const normalized = normalizeLabels(labels);
    const key = keyFor(name, normalized);
    const state = this.histograms.get(key) ?? {
      buckets: DEFAULT_MS_BUCKETS,
      bucketCounts: new Array(DEFAULT_MS_BUCKETS.length + 1).fill(0),
      sum: 0,
      count: 0,
    };

    const v = Math.max(0, valueMs);
    state.sum += v;
    state.count += 1;

    let placed = false;
    for (let i = 0; i < state.buckets.length; i += 1) {
      if (v <= state.buckets[i]) {
        state.bucketCounts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      state.bucketCounts[state.bucketCounts.length - 1] += 1; // +Inf
    }

    this.histograms.set(key, state);
  }

  public renderPrometheus(extraLines: string[] = []): string {
    const lines: string[] = [];

    const counterNames = new Set<string>();
    for (const key of this.counters.keys()) {
      counterNames.add(key.split("|")[0]);
    }
    for (const name of [...counterNames].sort()) {
      lines.push(`# TYPE ${name} counter`);
    }

    const histogramNames = new Set<string>();
    for (const key of this.histograms.keys()) {
      histogramNames.add(key.split("|")[0]);
    }
    for (const name of [...histogramNames].sort()) {
      lines.push(`# TYPE ${name} histogram`);
    }

    for (const [compoundKey, value] of [...this.counters.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const [name, labelPart] = compoundKey.split("|");
      const labels: Record<string, string> = {};
      if (labelPart) {
        for (const pair of labelPart.split(",")) {
          const [k, v] = pair.split("=");
          if (k && v !== undefined) labels[k] = v;
        }
      }
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }

    for (const [compoundKey, state] of [...this.histograms.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const [name, labelPart] = compoundKey.split("|");
      const baseLabels: Record<string, string> = {};
      if (labelPart) {
        for (const pair of labelPart.split(",")) {
          const [k, v] = pair.split("=");
          if (k && v !== undefined) baseLabels[k] = v;
        }
      }

      let cumulative = 0;
      for (let i = 0; i < state.buckets.length; i += 1) {
        cumulative += state.bucketCounts[i];
        lines.push(
          `${name}_bucket${formatLabels({ ...baseLabels, le: String(state.buckets[i]) })} ${cumulative}`,
        );
      }
      cumulative += state.bucketCounts[state.bucketCounts.length - 1];
      lines.push(`${name}_bucket${formatLabels({ ...baseLabels, le: "+Inf" })} ${cumulative}`);
      lines.push(`${name}_sum${formatLabels(baseLabels)} ${state.sum}`);
      lines.push(`${name}_count${formatLabels(baseLabels)} ${state.count}`);
    }

    for (const line of extraLines) {
      lines.push(line);
    }

    return `${lines.join("\n")}\n`;
  }
}

export const estimateFetchCostUnits = (params: {
  cache_hit: boolean;
  retry_attempt: number;
  fast_mode: boolean;
}): number => {
  const retryAttempt = Math.max(1, params.retry_attempt || 1);
  const retryPenalty = Math.max(0, retryAttempt - 1);
  const base = params.cache_hit ? 0.15 : 1;
  const fastFactor = params.fast_mode ? 0.85 : 1;
  return Number((base * fastFactor + retryPenalty).toFixed(4));
};

export const readPerformanceFields = (
  result: unknown,
): { cache_hit: boolean; retry_attempt: number } => {
  if (!isRecord(result)) return { cache_hit: false, retry_attempt: 1 };
  const cache = isRecord(result.cache) ? result.cache : null;
  const performance = isRecord(result.performance) ? result.performance : null;
  const cacheHit = Boolean(cache && cache.hit === true);
  const retryAttemptRaw = performance ? performance.retry_attempt : undefined;
  const retryAttempt =
    typeof retryAttemptRaw === "number" && Number.isFinite(retryAttemptRaw)
      ? retryAttemptRaw
      : 1;
  return { cache_hit: cacheHit, retry_attempt: retryAttempt };
};

