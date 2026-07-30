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

export type MediaResourceProvider = "edgeone" | "supabase" | "tencent_cos" | "other";

export interface MediaResourceSample {
  name: string;
  startTimeMs: number;
  durationMs: number;
  responseStartMs: number;
  transferSizeBytes: number;
  decodedBodySizeBytes: number;
}

export interface MediaResourceSummary {
  provider: MediaResourceProvider;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  averageTtfbMs: number | null;
  observableTimingCount: number;
  transferredBytes: number;
  decodedBytes: number;
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

export function mediaResourceProvider(resourceUrl: string): MediaResourceProvider {
  try {
    const host = new URL(resourceUrl).hostname.toLowerCase();
    if (host === "media.maplestorynk.online" || host.endsWith(".eo.dnse0.com")) return "edgeone";
    if (host.endsWith(".supabase.co")) return "supabase";
    if (host.endsWith(".myqcloud.com") || host.endsWith(".cos.ap-guangzhou.myqcloud.com")) return "tencent_cos";
  } catch {
    return "other";
  }
  return "other";
}

export function summarizeMediaResources(samples: MediaResourceSample[]): MediaResourceSummary[] {
  const groups = new Map<MediaResourceProvider, MediaResourceSample[]>();
  for (const sample of samples) {
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) continue;
    const provider = mediaResourceProvider(sample.name);
    groups.set(provider, [...(groups.get(provider) || []), sample]);
  }
  return [...groups.entries()].map(([provider, entries]) => {
    const durations = entries.map((entry) => Math.max(0, entry.durationMs));
    const ttfbValues = entries
      .filter((entry) => entry.responseStartMs > 0 && entry.responseStartMs >= entry.startTimeMs)
      .map((entry) => Math.max(0, entry.responseStartMs - entry.startTimeMs));
    return {
      provider,
      count: entries.length,
      totalDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0)),
      maxDurationMs: Math.round(Math.max(...durations)),
      averageTtfbMs: ttfbValues.length
        ? Math.round(ttfbValues.reduce((sum, value) => sum + value, 0) / ttfbValues.length)
        : null,
      observableTimingCount: ttfbValues.length,
      transferredBytes: entries.reduce((sum, entry) => sum + Math.max(0, entry.transferSizeBytes), 0),
      decodedBytes: entries.reduce((sum, entry) => sum + Math.max(0, entry.decodedBodySizeBytes), 0)
    };
  }).sort((left, right) => right.totalDurationMs - left.totalDurationMs);
}

export function shouldReportMediaResources(summaries: MediaResourceSummary[]) {
  return summaries.some((summary) => summary.maxDurationMs >= 1_000 || summary.totalDurationMs >= 3_000);
}
