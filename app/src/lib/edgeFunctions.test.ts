import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { EdgeFunctionError, invokeEdgeFunction } from "./edgeFunctions";

describe("Edge Function diagnostics", () => {
  it("preserves status, response code, stage and request id from a non-2xx response", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ code: "COS_STS_FORBIDDEN", stage: "credentials", error: "STS permission denied", request_id: "req-123", bucket: "private" }), {
          status: 403,
          headers: { "x-request-id": "header-id" }
        })
      }
    });

    const error = await invokeEdgeFunction("cos-credentials", { purpose: "content-media" }, "credentials").catch((value) => value);
    expect(error).toMatchObject({
      name: "EdgeFunctionError",
      functionName: "cos-credentials",
      stage: "credentials",
      status: 403,
      code: "COS_STS_FORBIDDEN",
      requestId: "req-123",
      message: "STS permission denied"
    });
    expect(error).toBeInstanceOf(EdgeFunctionError);
  });

  it("parses a plain-text response and derives a stable code", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code", context: new Response("Unauthorized", { status: 401 }) }
    });

    await expect(invokeEdgeFunction("vod-signature", {}, "signature")).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
      message: "Unauthorized"
    });
  });

  it("returns successful data without changing its shape", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, value: 7 }, error: null });
    await expect(invokeEdgeFunction("cos-credentials", {}, "credentials")).resolves.toEqual({ ok: true, value: 7 });
  });
});
