import { describe, expect, it, vi } from "vitest";
import { uploadResumableObject } from "./resumableUpload";

describe("uploadResumableObject", () => {
  it("creates a TUS upload and sends the file in resumable chunks", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (init?.method === "POST") return new Response(null, { status: 201, headers: { location: "/storage/v1/upload/resumable/upload-1", "upload-offset": "0" } });
      if (init?.method === "PATCH") {
        const offset = Number((init.headers as Record<string, string>)["Upload-Offset"]);
        const size = (init.body as ArrayBuffer).byteLength;
        return new Response(null, { status: 204, headers: { "upload-offset": String(offset + size) } });
      }
      throw new Error("unexpected request");
    }) as unknown as typeof fetch;

    await uploadResumableObject({
      endpoint: "https://project.example.test/storage/v1/upload/resumable",
      accessToken: "access-token", publishableKey: "public-key", bucket: "maplestorynk-public",
      objectPath: "imports/task/image.png", contentType: "image/png", data: new ArrayBuffer(11),
      chunkSize: 5, fetchImpl
    });

    expect(requests.map((request) => request.init?.method)).toEqual(["POST", "PATCH", "PATCH", "PATCH"]);
    expect((requests[0].init?.headers as Record<string, string>)["Upload-Metadata"]).toContain("bucketName");
    expect(requests.slice(1).map((request) => (request.init?.body as ArrayBuffer).byteLength)).toEqual([5, 5, 1]);
  });

  it("resumes from the server offset after a conflicting chunk", async () => {
    const methods: string[] = [];
    let patchCount = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      methods.push(init?.method || "GET");
      if (init?.method === "POST") return new Response(null, { status: 201, headers: { location: "/upload-2", "upload-offset": "0" } });
      if (init?.method === "PATCH" && patchCount++ === 0) return new Response("conflict", { status: 409 });
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "upload-offset": "3" } });
      return new Response(null, { status: 204, headers: { "upload-offset": "8" } });
    }) as unknown as typeof fetch;

    await uploadResumableObject({
      endpoint: "https://project.example.test/upload", accessToken: "token", publishableKey: "key",
      bucket: "bucket", objectPath: "image.png", contentType: "image/png", data: new ArrayBuffer(8), chunkSize: 8, fetchImpl
    });

    expect(methods).toEqual(["POST", "PATCH", "HEAD", "PATCH"]);
  });
});

