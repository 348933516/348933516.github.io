import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCanPlayVideo, normalizedVideoMimeType, probeBrowserVideoPlayback, validateUpload } from "./uploads";

afterEach(() => vi.restoreAllMocks());

describe("COS-only video routing", () => {
  it("normalizes MP4 and WebM by extension when the browser supplies a generic MIME", () => {
    expect(normalizedVideoMimeType(new File(["x"], "clip.MP4", { type: "application/octet-stream" }))).toBe("video/mp4");
    expect(normalizedVideoMimeType(new File(["x"], "clip.webm", { type: "" }))).toBe("video/webm");
    expect(normalizedVideoMimeType(new File(["x"], "clip.mov", { type: "video/quicktime" }))).toBeNull();
  });

  it("routes standard MP4/WebM to COS without using canPlayType as a VOD switch", () => {
    const file = new File(["x"], "clip.mp4", { type: "application/octet-stream" });
    expect(validateUpload(file)).toMatchObject({ video: true });
    expect(browserCanPlayVideo(file)).toBe(true);
  });

  it("uses metadata instead of waiting for a large video's first decoded frame", async () => {
    const createObjectURL = vi.fn(() => "blob:test-video");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "video") {
        Object.defineProperty(element, "load", {
          configurable: true,
          value: vi.fn(() => queueMicrotask(() => element.dispatchEvent(new Event("loadedmetadata"))))
        });
        Object.defineProperty(element, "pause", { configurable: true, value: vi.fn() });
      }
      return element;
    }) as typeof document.createElement);

    await expect(probeBrowserVideoPlayback(new Blob(["video"], { type: "video/mp4" }), "clip.mp4")).resolves.toEqual({
      mimeType: "video/mp4",
      playable: true
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-video");
  });
});
