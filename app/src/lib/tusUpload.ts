import * as tus from "tus-js-client";

export type TusUploadProgress = { loaded: number; total: number; retries: number; resumed: boolean };

export class TusUploadError extends Error {
  readonly status: number | null;
  readonly retryCount: number;

  constructor(message: string, status: number | null, retryCount: number) {
    super(message);
    this.name = "TusUploadError";
    this.status = status;
    this.retryCount = retryCount;
  }
}

export type SupabaseTusUploadInput = {
  file: File;
  endpoint: string;
  accessToken: string;
  publishableKey: string;
  bucket: string;
  objectPath: string;
  fingerprint: string;
  onProgress?(value: TusUploadProgress): void;
  onEvent?(event: { phase: "resume" | "retry" | "complete"; detail?: string; retries: number }): void;
};

export async function uploadSupabaseTus(input: SupabaseTusUploadInput) {
  return new Promise<{ uploadUrl: string | null; retries: number; resumed: boolean }>(async (resolve, reject) => {
    let retries = 0;
    let resumed = false;
    const upload = new tus.Upload(input.file, {
      endpoint: input.endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1_000, 3_000, 6_000, 12_000],
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: false,
      fingerprint: async () => input.fingerprint,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        apikey: input.publishableKey,
        "x-upsert": "false"
      },
      metadata: {
        bucketName: input.bucket,
        objectName: input.objectPath,
        contentType: input.file.type || "application/octet-stream",
        cacheControl: "3600"
      },
      onShouldRetry: (_error, attempt) => {
        retries = attempt + 1;
        input.onEvent?.({ phase: "retry", retries });
        return true;
      },
      onError: (error) => {
        const response = "originalResponse" in error ? error.originalResponse : null;
        const status = response ? response.getStatus() : null;
        reject(new TusUploadError(error.message, status || null, retries));
      },
      onProgress: (loaded, total) => input.onProgress?.({ loaded, total, retries, resumed }),
      onSuccess: () => {
        input.onEvent?.({ phase: "complete", retries });
        resolve({ uploadUrl: upload.url || null, retries, resumed });
      }
    });
    try {
      const previous = await upload.findPreviousUploads();
      if (previous[0]) {
        upload.resumeFromPreviousUpload(previous[0]);
        resumed = true;
        input.onEvent?.({ phase: "resume", detail: previous[0].uploadUrl || undefined, retries });
      }
      upload.start();
    } catch (error) {
      reject(error instanceof Error ? error : new Error("无法恢复 TUS 上传"));
    }
  });
}
