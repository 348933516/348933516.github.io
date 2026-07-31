import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoPlayer } from "./VideoPlayer";

afterEach(() => {
  vi.useRealTimers();
});

describe("video player", () => {
  it("embeds Tencent VOD by app id and file id", () => {
    render(<VideoPlayer media={{ src: "", title: "演示", videoProvider: "tencent_vod", providerAppId: "1400000000", providerFileId: "5280000000001", processingStatus: "ready" }} />);
    expect(screen.getByTitle("演示")).toHaveAttribute("src", expect.stringContaining("appid=1400000000&fileid=5280000000001"));
  });

  it("keeps a native fallback for legacy videos", () => {
    const { container } = render(<VideoPlayer media={{ src: "https://example.com/legacy.mp4", title: "旧视频", mimeType: "video/mp4", processingStatus: "ready" }} />);
    expect(container.querySelector("video source")).toHaveAttribute("src", "https://example.com/legacy.mp4");
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toHaveAttribute("controlslist", "nodownload noremoteplayback");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    video.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("explains that a video with no public source is waiting for publication", () => {
    const { container } = render(<VideoPlayer media={{ src: "", title: "草稿视频", mimeType: "video/mp4", processingStatus: "ready" }} />);
    expect(screen.getByText("视频尚未公开")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });

  it("prefers a managed playback URL and poster when available", () => {
    const { container } = render(<VideoPlayer media={{ src: "https://example.com/original.mp4", playbackUrl: "https://media.example.com/video.mp4", posterUrl: "https://media.example.com/poster.webp", title: "视频", mimeType: "video/mp4", processingStatus: "ready" }} />);
    expect(container.querySelector("video source")).toHaveAttribute("src", "https://media.example.com/video.mp4");
    expect(container.querySelector("video")).toHaveAttribute("poster", "https://media.example.com/poster.webp");
  });

  it("reports an audio-only decode when playback advances without a video frame", async () => {
    vi.useFakeTimers();
    const { container } = render(<VideoPlayer media={{ src: "https://example.com/hevc.mp4", title: "不兼容视频", mimeType: "video/mp4", processingStatus: "ready" }} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "currentTime", { configurable: true, value: 2 });
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    Object.defineProperty(video, "requestVideoFrameCallback", { configurable: true, value: vi.fn(() => 1) });
    fireEvent.play(video);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });

    expect(screen.getByText("视频有声音但没有画面")).toBeInTheDocument();
    expect(screen.getByText(/H\.264\/AAC MP4/)).toBeInTheDocument();
  });
});
