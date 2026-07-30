import { supabase } from "./supabase";

export interface EdgeFunctionErrorOptions {
  functionName: string;
  stage: string;
  status?: number | null;
  code?: string | null;
  message: string;
  requestId?: string | null;
  details?: Record<string, unknown>;
}

export class EdgeFunctionError extends Error {
  readonly functionName: string;
  readonly stage: string;
  readonly status: number | null;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown>;

  constructor(options: EdgeFunctionErrorOptions) {
    super(options.message);
    this.name = "EdgeFunctionError";
    this.functionName = options.functionName;
    this.stage = options.stage;
    this.status = options.status ?? null;
    this.code = options.code || fallbackErrorCode(options.status);
    this.requestId = options.requestId || null;
    this.details = options.details || {};
  }

  toLogContext(extra: Record<string, unknown> = {}) {
    return {
      ...extra,
      edgeFunction: this.functionName,
      stage: this.stage,
      httpStatus: this.status,
      errorCode: this.code,
      requestId: this.requestId
    };
  }
}

function fallbackErrorCode(status?: number | null) {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "ROLE_FORBIDDEN";
  if (status === 404) return "FUNCTION_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status && status >= 500) return "EDGE_FUNCTION_UNAVAILABLE";
  return "EDGE_FUNCTION_FAILED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeString(value: unknown, maxLength = 800) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function readEdgeFunctionResponse(error: unknown) {
  const context = error && typeof error === "object" && "context" in error
    ? (error as { context?: unknown }).context
    : null;
  if (!(context instanceof Response)) return { status: null, headers: new Headers(), payload: {} as Record<string, unknown> };

  let payload: Record<string, unknown> = {};
  try {
    const parsed = await context.clone().json();
    if (isRecord(parsed)) payload = parsed;
  } catch {
    try {
      const text = await context.clone().text();
      if (text.trim()) payload = { error: text.slice(0, 800) };
    } catch {
      // Keep the transport error when the response body cannot be read.
    }
  }
  return { status: context.status || null, headers: context.headers, payload };
}

function requestIdFrom(payload: Record<string, unknown>, headers: Headers) {
  return safeString(
    payload.request_id ?? payload.requestId ?? headers.get("x-request-id") ?? headers.get("sb-request-id"),
    160
  ) || null;
}

export async function invokeEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
  stage = functionName
) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  const dataPayload = isRecord(data) ? data : {};
  if (!error && !dataPayload.error) return data as T;

  const response = await readEdgeFunctionResponse(error);
  const payload = { ...response.payload, ...dataPayload };
  const code = safeString(payload.code, 120) || null;
  const message = safeString(payload.error) || safeString(payload.message) || safeString(error?.message) || "Edge Function request failed";
  const details = Object.fromEntries(Object.entries(payload).filter(([key]) => !["error", "message", "code", "request_id", "requestId"].includes(key)));
  throw new EdgeFunctionError({
    functionName,
    stage: safeString(payload.stage, 80) || stage,
    status: response.status,
    code,
    message,
    requestId: requestIdFrom(payload, response.headers),
    details
  });
}

