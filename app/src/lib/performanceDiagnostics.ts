export interface LongTaskSample {
  durationMs: number;
  startTimeMs: number;
  route: string;
}

export interface LongTaskSummary {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  topDurationsMs: number[];
  firstStartTimeMs: number;
  lastStartTimeMs: number;
}

export const longTaskMinimumMs = 200;
export const longTaskReportCooldownMs = 120_000;

export function summarizeLongTasks(samples: LongTaskSample[]): LongTaskSummary | null {
  const relevant = samples.filter((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= longTaskMinimumMs);
  if (!relevant.length) return null;
  const durations = relevant.map((sample) => Math.round(sample.durationMs));
  const starts = relevant.map((sample) => Math.round(sample.startTimeMs));
  return {
    count: relevant.length,
    totalDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
    maxDurationMs: Math.max(...durations),
    topDurationsMs: [...durations].sort((left, right) => right - left).slice(0, 5),
    firstStartTimeMs: Math.min(...starts),
    lastStartTimeMs: Math.max(...starts)
  };
}

export function shouldReportLongTasks(summary: LongTaskSummary | null) {
  return Boolean(summary && (summary.maxDurationMs >= 500 || summary.totalDurationMs >= 1_500));
}
