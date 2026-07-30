import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  uploadFile: vi.fn(),
  multipartInit: vi.fn(),
  multipartUpload: vi.fn(),
  multipartComplete: vi.fn(),
  multipartAbort: vi.fn()
}));

vi.mock("./edgeFunctions", async () => {
  const actual = await vi.importActual<typeof import("./edgeFunctions")>("./edgeFunctions");
  return { ...actual, invokeEdgeFunction: mocks.credentials };
});

vi.mock("cos-js-sdk-v5", () => ({
  default: class {
    uploadFile = mocks.uploadFile;
    multipartInit = mocks.multipartInit;
    multipartUpload = mocks.multipartUpload;
    multipartComplete = mocks.multipartComplete;
    multipartAbort = mocks.multipartAbort;
    cancelTask = vi.fn();
  }
}));

beforeEach(async () => {
  vi.clearAllMocks();
  const { clearCosCredentialCache } = await import("./cosUpload");
  clearCosCredentialCache();
  mocks.credentials.mockResolvedValue({
    tmpSecretId: "temporary-id",
    tmpSecretKey: "temporary-key",
    sessionToken: "session-token",
    startTime: 100,
    expiredTime: Math.floor(Date.now() / 1000) + 1800,
    bucket: "maplestorynk-private-1331200863",
    region: "ap-guangzhou",
    prefix: "drafts/22222222-2222-4222-8222-222222222222/",
    policyAppIdVerified: true
  });
  mocks.multipartInit.mockResolvedValue({ UploadId: "upload-1" });
  mocks.multipartUpload.mockResolvedValue({ ETag: '"part-etag"' });
  mocks.multipartComplete.mockResolvedValue({ ETag: '"complete-etag"' });
  mocks.multipartAbort.mockResolvedValue({});
});

describe("COS upload diagnostics", () => {
  it("preserves multipart operation, status, and request ID", async () => {
    const { toCosUploadError } = await import("./cosUpload");
    const error = toCosUploadError({
      statusCode: 403,
      error: { Code: "AccessDenied", RequestId: "request-123" },
      errorNode: "multipartList"
    }, { bucket: "private-bucket", stage: "multipart", retryCount: 1 });

    expect(error.details).toMatchObject({
      operation: "ListMultipartUploads",
      httpStatus: 403,
      cosRequestId: "request-123",
      stage: "multipart",
      retryCount: 1,
      code: "AccessDenied",
      policyAppIdVerified: false
    });
    expect(error.message).toContain("request-123");
  });

  it("clears cached credentials and retries one authorization failure", async () => {
    const { uploadToCos } = await import("./cosUpload");
    mocks.uploadFile
      .mockRejectedValueOnce({ statusCode: 403, error: { Code: "AccessDenied", RequestId: "first" } })
      .mockResolvedValueOnce({ ETag: '"etag-2"' });

    const stored = await uploadToCos({
      file: new Blob(["small"], { type: "application/octet-stream" }),
      path: "drafts/22222222-2222-4222-8222-222222222222/video.mp4",
      scope: {
        purpose: "content-media",
        contentId: "22222222-2222-4222-8222-222222222222",
        prefix: "drafts/22222222-2222-4222-8222-222222222222/",
        visibility: "private"
      }
    });

    expect(mocks.uploadFile).toHaveBeenCalledTimes(2);
    expect(mocks.credentials).toHaveBeenCalledTimes(2);
    expect(stored).toMatchObject({ provider: "tencent_cos", etag: "etag-2" });
  });

  it("uses an explicit multipart sequence without listing bucket uploads", async () => {
    const { uploadToCos } = await import("./cosUpload");
    const stored = await uploadToCos({
      file: new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "video/mp4" }),
      path: "drafts/22222222-2222-4222-8222-222222222222/video.mp4",
      scope: {
        purpose: "content-media",
        contentId: "22222222-2222-4222-8222-222222222222",
        prefix: "drafts/22222222-2222-4222-8222-222222222222/",
        visibility: "private"
      }
    });

    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(mocks.multipartInit).toHaveBeenCalledTimes(1);
    expect(mocks.multipartUpload).toHaveBeenCalledTimes(2);
    expect(mocks.multipartComplete).toHaveBeenCalledWith(expect.objectContaining({
      UploadId: "upload-1",
      Parts: [
        { PartNumber: 1, ETag: '"part-etag"' },
        { PartNumber: 2, ETag: '"part-etag"' }
      ]
    }));
    expect(stored).toMatchObject({ etag: "complete-etag", sizeBytes: 6 * 1024 * 1024 });
  });

  it("reports the exact explicit multipart operation and aborts an incomplete upload", async () => {
    const { uploadToCos } = await import("./cosUpload");
    mocks.multipartUpload.mockRejectedValue({
      statusCode: 403,
      error: { Code: "AccessDenied", RequestId: "upload-part-denied" }
    });

    const error = await uploadToCos({
      file: new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "video/mp4" }),
      path: "drafts/22222222-2222-4222-8222-222222222222/video.mp4",
      scope: {
        purpose: "content-media",
        contentId: "22222222-2222-4222-8222-222222222222",
        prefix: "drafts/22222222-2222-4222-8222-222222222222/",
        visibility: "private"
      }
    }).catch((value) => value);

    expect(error.details).toMatchObject({
      operation: "UploadPart",
      cosRequestId: "upload-part-denied",
      retryCount: 1
    });
    expect(mocks.multipartAbort).toHaveBeenCalledTimes(2);
  });
});
