import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./edgeFunctions", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./edgeFunctions")>();
  return { ...original, invokeEdgeFunction: mocks.invoke };
});

import { uploadVideoToVod, vodUploadEnabled } from "./vod";

describe("VOD fallback", () => {
  it("is disabled by default and does not request a signature", async () => {
    expect(vodUploadEnabled).toBe(false);
    await expect(uploadVideoToVod(new File(["video"], "clip.mp4", { type: "video/mp4" }), vi.fn())).rejects.toMatchObject({
      code: "VOD_DISABLED",
      stage: "route",
      status: 409
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

