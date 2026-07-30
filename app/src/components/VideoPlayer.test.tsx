import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoPlayer } from "./VideoPlayer";

describe("video player", () => {
  it("embeds Tencent VOD by app id and file id", () => {
    render(<VideoPlayer media={{ src: "", title: "演示", videoProvider: "tencent_vod", providerAppId: "1400000000", providerFileId: "5280000000001", processingStatus: "ready" }} />);
    expect(screen.getByTitle("演示")).toHaveAttribute("src", expect.stringContaining("appid=1400000000&fileid=5280000000001"));
  });

  it("keeps a native fallback for legacy videos", () => {
    const { container } = render(<VideoPlayer media={{ src: "https://example.com/legacy.mp4", title: "旧视频", mimeType: "video/mp4", processingStatus: "ready" }} />);
    expect(container.querySelector("video source")).toHaveAttribute("src", "https://example.com/legacy.mp4");
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
});
