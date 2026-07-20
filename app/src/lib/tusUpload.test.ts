import { describe, expect, it, vi } from "vitest";

const state: { previous: Array<{ uploadUrl: string | null }>; options?: Record<string, unknown>; mode: "success" | "error" } = { previous: [], mode: "success" };

vi.mock("tus-js-client", () => ({
  Upload: class FakeUpload {
    url: string | null = "https://uploads.example.test/new";
    constructor(_file: File, options: Record<string, unknown>) { state.options = options; }
    async findPreviousUploads() { return state.previous; }
    resumeFromPreviousUpload(upload: { uploadUrl: string | null }) { this.url = upload.uploadUrl; }
    start() {
      const options = state.options!;
      if (state.mode === "error") {
        (options.onError as (error: Error & { originalResponse: { getStatus(): number } }) => void)(Object.assign(new Error("storage rejected upload"), { originalResponse: { getStatus: () => 413 } }));
        return;
      }
      (options.onProgress as (loaded: number, total: number) => void)(12, 12);
      (options.onSuccess as () => void)();
    }
  }
}));

import { TusUploadError, uploadSupabaseTus } from "./tusUpload";

const input = () => ({
  file: { size: 12, type: "image/png" } as File,
  endpoint: "https://project.example.test/storage/v1/upload/resumable",
  accessToken: "access-token", publishableKey: "publishable-key", bucket: "maplestorynk-public",
  objectPath: "imports/job/001.png", fingerprint: "document:job:1"
});

describe("Supabase TUS uploads", () => {
  it("resumes a previous upload with the deterministic fingerprint", async () => {
    state.previous = [{ uploadUrl: "https://uploads.example.test/resume" }]; state.mode = "success";
    const events: string[] = [];
    const result = await uploadSupabaseTus({ ...input(), onEvent: (event) => events.push(event.phase) });
    expect(result).toMatchObject({ uploadUrl: "https://uploads.example.test/resume", resumed: true });
    expect(events).toEqual(["resume", "complete"]);
    expect(await (state.options?.fingerprint as () => Promise<string>)()).toBe("document:job:1");
  });

  it("exposes the storage HTTP status without leaking credentials", async () => {
    state.previous = []; state.mode = "error";
    await expect(uploadSupabaseTus(input())).rejects.toMatchObject({ name: "TusUploadError", status: 413, retryCount: 0 } satisfies Partial<TusUploadError>);
  });
});
