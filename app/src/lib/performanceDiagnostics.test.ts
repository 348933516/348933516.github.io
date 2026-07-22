import { describe, expect, it } from "vitest";
import { shouldReportLongTasks, summarizeLongTasks } from "./performanceDiagnostics";

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
});
