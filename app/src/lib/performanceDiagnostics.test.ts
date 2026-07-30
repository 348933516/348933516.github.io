import { describe, expect, it } from "vitest";
import { mediaResourceProvider, shouldReportLongTasks, shouldReportMediaResources, summarizeLongTasks, summarizeMediaResources } from "./performanceDiagnostics";

describe("performance diagnostics", () => {
  it("ignores routine tasks below the interaction-impact threshold", () => {
    const summary = summarizeLongTasks([
      { durationMs: 51, startTimeMs: 10, route: "/admin/contents" },
      { durationMs: 199, startTimeMs: 20, route: "/admin/contents" }
    ]);
    expect(summary).toBeNull();
    expect(shouldReportLongTasks(summary)).toBe(false);
  });

  it("reports a severe task with compact diagnostics", () => {
    const summary = summarizeLongTasks([
      { durationMs: 2414, startTimeMs: 200, route: "/admin/contents" },
      { durationMs: 304, startTimeMs: 2800, route: "/admin/contents" }
    ]);
    expect(summary).toMatchObject({
      count: 2,
      totalDurationMs: 2718,
      maxDurationMs: 2414,
      topDurationsMs: [2414, 304],
      firstStartTimeMs: 200,
      lastStartTimeMs: 2800
    });
    expect(shouldReportLongTasks(summary)).toBe(true);
  });

  it("reports accumulated blocking even when each task is below 500ms", () => {
    const summary = summarizeLongTasks(Array.from({ length: 5 }, (_, index) => ({
      durationMs: 320,
      startTimeMs: index * 400,
      route: "/admin/contents"
    })));
    expect(summary?.totalDurationMs).toBe(1600);
    expect(shouldReportLongTasks(summary)).toBe(true);
  });

  it("classifies media hosts without retaining full URLs", () => {
    expect(mediaResourceProvider("https://media.maplestorynk.online/content/image.webp")).toBe("edgeone");
    expect(mediaResourceProvider("https://project.supabase.co/storage/v1/object/public/image.webp")).toBe("supabase");
    expect(mediaResourceProvider("https://bucket.cos.ap-guangzhou.myqcloud.com/image.webp")).toBe("tencent_cos");
    expect(mediaResourceProvider("not a url")).toBe("other");
  });

  it("summarizes slow media by provider", () => {
    const summaries = summarizeMediaResources([
      { name: "https://media.maplestorynk.online/a.webp", startTimeMs: 100, responseStartMs: 420, durationMs: 900, transferSizeBytes: 75_000, decodedBodySizeBytes: 75_000 },
      { name: "https://media.maplestorynk.online/b.webp", startTimeMs: 1_100, responseStartMs: 1_300, durationMs: 2_200, transferSizeBytes: 120_000, decodedBodySizeBytes: 120_000 },
      { name: "https://project.supabase.co/storage/image.webp", startTimeMs: 50, responseStartMs: 650, durationMs: 800, transferSizeBytes: 340_000, decodedBodySizeBytes: 340_000 }
    ]);
    expect(summaries[0]).toEqual({ provider: "edgeone", count: 2, totalDurationMs: 3100, maxDurationMs: 2200, averageTtfbMs: 260, observableTimingCount: 2, transferredBytes: 195_000, decodedBytes: 195_000 });
    expect(shouldReportMediaResources(summaries)).toBe(true);
  });

  it("marks cross-origin timing as unavailable instead of reporting a false zero", () => {
    const [summary] = summarizeMediaResources([
      { name: "https://media.maplestorynk.online/a.webp", startTimeMs: 100, responseStartMs: 0, durationMs: 1500, transferSizeBytes: 0, decodedBodySizeBytes: 0 }
    ]);
    expect(summary).toMatchObject({ averageTtfbMs: null, observableTimingCount: 0 });
  });
});
