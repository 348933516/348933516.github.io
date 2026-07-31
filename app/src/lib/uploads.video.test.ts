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

  it("accepts common source containers for the FFmpeg queue", () => {
    for (const name of ["clip.mov", "clip.m4v", "clip.mkv", "clip.avi"]) {
      expect(validateUpload(new File(["x"], name, { type: "application/octet-stream" }))).toMatchObject({ video: true });
    }
  });

  it("rejects a video that exposes metadata but never decodes a frame", async () => {
    vi.useFakeTimers();
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
        Object.defineProperty(element, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
        Object.defineProperty(element, "pause", { configurable: true, value: vi.fn() });
      }
      return element;
    }) as typeof document.createElement);

    const result = probeBrowserVideoPlayback(new Blob(["video"], { type: "video/mp4" }), "clip.mp4");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({
      mimeType: "video/mp4",
      playable: false,
      reason: "no-video-frame"
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-video");
    vi.useRealTimers();
  });

  it("accepts an MP4 only after the browser decodes a video frame", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-video-frame") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "video") {
        Object.defineProperty(element, "videoWidth", { configurable: true, value: 1920 });
        Object.defineProperty(element, "videoHeight", { configurable: true, value: 1080 });
        Object.defineProperty(element, "requestVideoFrameCallback", {
          configurable: true,
          value: vi.fn((callback: VideoFrameRequestCallback) => {
            queueMicrotask(() => callback(0, {} as VideoFrameCallbackMetadata));
            return 1;
          })
        });
        Object.defineProperty(element, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
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
  });
});
