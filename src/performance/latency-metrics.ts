export interface StageDistribution {
  count: number;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  p50_ms: number;
  p95_ms: number;
}

export interface LatencyMetricsSnapshot {
  sample_count: number;
  stages: Record<string, StageDistribution>;
  generated_at: string;
}

const quantile = (sortedValues: number[], ratio: number): number => {
  if (sortedValues.length === 0) return 0;
  const pos = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sortedValues[lower];
  const weight = pos - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
};

const summarize = (values: number[]): StageDistribution => {
  if (values.length === 0) {
    return {
      count: 0,
      avg_ms: 0,
      min_ms: 0,
      max_ms: 0,
      p50_ms: 0,
      p95_ms: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    avg_ms: Number((total / sorted.length).toFixed(2)),
    min_ms: sorted[0],
    max_ms: sorted[sorted.length - 1],
    p50_ms: Number(quantile(sorted, 0.5).toFixed(2)),
    p95_ms: Number(quantile(sorted, 0.95).toFixed(2)),
  };
};

export class LatencyMetricsTracker {
  private readonly maxSamples: number;
  private readonly samples: Array<Record<string, number>> = [];

  public constructor(maxSamples = 500) {
    this.maxSamples = maxSamples;
  }

  public record(stageLatency: Record<string, number>): void {
    this.samples.push({ ...stageLatency });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  public snapshot(): LatencyMetricsSnapshot {
    const stageBuckets = new Map<string, number[]>();
    for (const sample of this.samples) {
      for (const [stage, value] of Object.entries(sample)) {
        if (!Number.isFinite(value)) continue;
        const list = stageBuckets.get(stage) ?? [];
        list.push(value);
        stageBuckets.set(stage, list);
      }
    }

    const stages: Record<string, StageDistribution> = {};
    for (const [stage, values] of stageBuckets.entries()) {
      stages[stage] = summarize(values);
    }

    return {
      sample_count: this.samples.length,
      stages,
      generated_at: new Date().toISOString(),
    };
  }
}
