import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { publishContent } from "./repository";

describe("content publication diagnostics", () => {
  it("preserves the server stage, COS status and request ID", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({
          error: "COS copy was denied",
          code: "COS_COPY_ACCESS_DENIED",
          stage: "copy-media",
          request_id: "edge-request",
          cos_request_id: "cos-request",
          http_status: 403
        }), { status: 502 })
      }
    });

    await expect(publishContent("content-id", 4)).rejects.toMatchObject({
      name: "EdgeFunctionError",
      functionName: "publish-content",
      stage: "copy-media",
      status: 502,
      code: "COS_COPY_ACCESS_DENIED",
      requestId: "edge-request",
      details: expect.objectContaining({ cos_request_id: "cos-request", http_status: 403 })
    });
  });
});
