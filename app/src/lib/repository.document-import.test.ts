import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { getDocumentImportStatus, startDocumentImport } from "./repository";

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
});
