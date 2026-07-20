import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { startDocumentImport } from "./repository";

describe("document import function errors", () => {
  it("keeps the server response instead of replacing it with a generic non-2xx error", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify({ error: "部分图片未成功写入存储", code: "STORAGE_OBJECTS_MISSING", stage: "finalize", import_id: "job-1", missing_count: 2 }), { status: 400 }) }
    });

    await expect(startDocumentImport({ contentId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1, expectedImages: 1, totalOriginalBytes: 10 })).rejects.toMatchObject({
      name: "DocumentImportError",
      stage: "start",
      status: 400,
      code: "STORAGE_OBJECTS_MISSING",
      message: "部分图片未成功写入存储"
    });
  });
});
