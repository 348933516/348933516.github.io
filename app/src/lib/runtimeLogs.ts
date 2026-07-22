import { longTaskMinimumMs, longTaskReportCooldownMs, shouldReportLongTasks, summarizeLongTasks, type LongTaskSample } from "./performanceDiagnostics";
import { supabase } from "./supabase";

export type RuntimeSeverity = "info" | "warning" | "error";

export interface RuntimeLogInput {
  source: string;
  message: string;
  severity?: RuntimeSeverity;
  error?: unknown;
  context?: Record<string, unknown>;
  route?: string;
}

function safeContext(value: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => {
    if (/password|token|secret|body|html|content/i.test(key)) return [key, "[redacted]"];
    if (typeof item === "string") return [key, item.slice(0, 500)];
    if (["number", "boolean"].includes(typeof item) || item == null) return [key, item];
    return [key, String(item).slice(0, 500)];
  }));
}

function currentRoute() {
  return `${window.location.pathname}${window.location.hash}`;
}

function appVersion() {
  return import.meta.env.VITE_APP_VERSION || (window.location.pathname.startsWith("/preview") ? "preview" : "production");
}

export async function reportRuntimeLog(input: RuntimeLogInput) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const error = input.error instanceof Error ? input.error : null;
    await supabase.from("runtime_logs").insert({
      actor_id: data.user.id,
      severity: input.severity || "error",
      source: input.source.slice(0, 80),
      message: input.message.slice(0, 1000),
      stack: error?.stack?.slice(0, 8000) || null,
      route: (input.route || currentRoute()).slice(0, 500),
      app_version: appVersion(),
      context: safeContext(input.context)
    });
  } catch {
    // Runtime reporting must never interrupt the original workflow.
  }
}

export function installGlobalRuntimeLogging() {
  const onError = (event: ErrorEvent) => {
    void reportRuntimeLog({ source: "frontend", message: event.message || "未处理的页面错误", error: event.error });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    void reportRuntimeLog({ source: "promise", message: error.message || "未处理的异步错误", error });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  let performanceObserver: PerformanceObserver | null = null;
  let performanceTimer: number | null = null;
  const pendingByRoute = new Map<string, LongTaskSample[]>();
  const lastReportedAt = new Map<string, number>();

  if ("PerformanceObserver" in window) {
    try {
      performanceObserver = new PerformanceObserver((list) => {
        const route = currentRoute();
        const samples = pendingByRoute.get(route) || [];
        for (const entry of list.getEntries()) {
          if (entry.duration >= longTaskMinimumMs && samples.length < 30) {
            samples.push({ durationMs: entry.duration, startTimeMs: entry.startTime, route });
          }
        }
        if (samples.length) pendingByRoute.set(route, samples);
        if (!pendingByRoute.size || performanceTimer !== null) return;

        performanceTimer = window.setTimeout(() => {
          performanceTimer = null;
          const now = Date.now();
          const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
          const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;

          for (const [observedRoute, routeSamples] of pendingByRoute) {
            const summary = summarizeLongTasks(routeSamples);
            const lastReport = lastReportedAt.get(observedRoute) || 0;
            if (!summary || !shouldReportLongTasks(summary) || now - lastReport < longTaskReportCooldownMs) continue;
            lastReportedAt.set(observedRoute, now);
            void reportRuntimeLog({
              source: "performance",
              severity: "warning",
              route: observedRoute,
              message: `检测到 ${summary.count} 个严重主线程长任务`,
              context: {
                ...summary,
                topDurationsMs: summary.topDurationsMs.join(","),
                usedHeapBytes: memory?.usedJSHeapSize,
                heapLimitBytes: memory?.jsHeapSizeLimit,
                visibilityState: document.visibilityState,
                navigationType: navigation?.type || "unknown"
              }
            });
          }
          pendingByRoute.clear();
        }, 15_000);
      });
      performanceObserver.observe({ type: "longtask" });
    } catch {
      performanceObserver = null;
    }
  }

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    performanceObserver?.disconnect();
    pendingByRoute.clear();
    lastReportedAt.clear();
    if (performanceTimer !== null) window.clearTimeout(performanceTimer);
  };
}
