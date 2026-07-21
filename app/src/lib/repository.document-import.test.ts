import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { getDocumentImportStatus, retryDocumentImport, startDocumentImport } from "./repository";

describe("document import function errors", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("normalizes the camelCase asset manifest returned by the Edge Function", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        job: { id: "job-1", status: "uploading", expectedImages: 1 },
        assets: [{
          mediaId: "00000000-0000-4000-8000-000000000001",
          imageIndex: 1,
          originalPath: "imports/job-1/001-original.png",
          displayPath: "imports/job-1/001-display.png",
          sortOrder: 10
        }],
        events: []
      },
      error: null
    });

    await expect(getDocumentImportStatus("job-1")).resolves.toMatchObject({
      assets: [{
        media_id: "00000000-0000-4000-8000-000000000001",
        image_index: 1,
        original_path: "imports/job-1/001-original.png",
        display_path: "imports/job-1/001-display.png",
        sort_order: 10
      }]
    });
  });

  it("keeps PostgreSQL diagnostics for a failed final commit", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({
          error: "图片已保留，但数据库提交失败。",
          code: "IMPORT_COMMIT_FAILED",
          stage: "finalize",
          database_error: "IMPORT_MEDIA_INSERT_FAILED [23505]: duplicate key value violates unique constraint"
        }), { status: 400 })
      }
    });

    await expect(startDocumentImport({ contentId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1, expectedImages: 1, totalOriginalBytes: 10 }))
      .rejects.toMatchObject({
        code: "IMPORT_COMMIT_FAILED",
        message: expect.stringContaining("IMPORT_MEDIA_INSERT_FAILED [23505]")
      });
  });

  it("requests a retry without uploading registered assets again", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, registered_assets: 98 }, error: null });

    await expect(retryDocumentImport("00000000-0000-4000-8000-000000000099")).resolves.toEqual({ ok: true, registered_assets: 98 });
    expect(mocks.invoke).toHaveBeenCalledWith("document-import", {
      body: { action: "retry", importId: "00000000-0000-4000-8000-000000000099" }
    });
  });
});
