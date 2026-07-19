import { supabase } from "./supabase";

export type RuntimeSeverity = "info" | "warning" | "error";

export interface RuntimeLogInput {
  source: string;
  message: string;
  severity?: RuntimeSeverity;
  error?: unknown;
  context?: Record<string, unknown>;
}

function safeContext(value: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => {
    if (/password|token|secret|body|html|content/i.test(key)) return [key, "[redacted]"];
    if (typeof item === "string") return [key, item.slice(0, 500)];
    if (["number", "boolean"].includes(typeof item) || item == null) return [key, item];
    return [key, String(item).slice(0, 500)];
  }));
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
      route: `${window.location.pathname}${window.location.hash}`.slice(0, 500),
      app_version: import.meta.env.VITE_APP_VERSION || "preview",
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
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
