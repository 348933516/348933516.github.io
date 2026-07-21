import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { getDocumentImportStatus, registerDocumentImportAsset, retryDocumentImport, startDocumentImport } from "./repository";

const asset = {
  mediaId: "00000000-0000-4000-8000-000000000001",
  imageIndex: 14,
  originalPath: "imports/job-1/014-original.png",
  displayPath: "imports/job-1/014-1600.webp",
  hash: "abc123",
  mimeType: "image/png",
  width: 1600,
  height: 900,
  originalSize: 100,
  displaySize: 50,
  imageVariants: [],
  sortOrder: 140,
  title: "图片 14",
  altText: "图片 14"
};

function functionError(status: number, payload: Record<string, unknown>) {
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify(payload), { status })
    }
  };
}

describe("document import function errors", () => {
  beforeEach(() => mocks.invoke.mockReset());
  afterEach(() => vi.useRealTimers());

  it("retries a degraded registration service and keeps the same idempotent request", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    mocks.invoke
      .mockResolvedValueOnce(functionError(503, { code: "SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED", message: "Service temporarily unavailable" }))
      .mockResolvedValueOnce(functionError(503, { code: "SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED", message: "Service temporarily unavailable" }))
      .mockResolvedValueOnce({ data: { registered_assets: 14 }, error: null });

    const request = registerDocumentImportAsset("00000000-0000-4000-8000-000000000099", asset, onRetry);
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ registered_assets: 14 });
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({ attempt: 2, maxAttempts: 5, status: 503 }));
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.objectContaining({ attempt: 3, maxAttempts: 5, status: 503 }));
    expect(mocks.invoke.mock.calls.every((call) => JSON.stringify(call) === JSON.stringify(mocks.invoke.mock.calls[0]))).toBe(true);
  });

  it("retries a rate-limited registration request", async () => {
    vi.useFakeTimers();
    mocks.invoke
      .mockResolvedValueOnce(functionError(429, { code: "RATE_LIMITED", error: "Too many requests" }))
      .mockResolvedValueOnce({ data: { registered_assets: 14 }, error: null });

    const request = registerDocumentImportAsset("00000000-0000-4000-8000-000000000099", asset);
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ registered_assets: 14 });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("does not retry a validation failure", async () => {
    mocks.invoke.mockResolvedValueOnce(functionError(400, { code: "INVALID_IMPORT_ASSET", error: "当前图片登记信息无效" }));

    await expect(registerDocumentImportAsset("00000000-0000-4000-8000-000000000099", asset)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_IMPORT_ASSET"
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves diagnostics after transient registration retries are exhausted", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(functionError(503, {
      code: "SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED",
      message: "Service temporarily unavailable",
      import_id: "00000000-0000-4000-8000-000000000099"
    }));

    const request = registerDocumentImportAsset("00000000-0000-4000-8000-000000000099", asset);
    const rejection = expect(request).rejects.toMatchObject({
      status: 503,
      code: "SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED",
      details: expect.objectContaining({ retry_count: 4, attempts: 5 })
    });
    await vi.runAllTimersAsync();

    await rejection;
    expect(mocks.invoke).toHaveBeenCalledTimes(5);
  });

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
