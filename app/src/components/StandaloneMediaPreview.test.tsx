import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StandaloneMediaPreview } from "./StandaloneMediaPreview";

describe("standalone body media", () => {
  it("renders an independently uploaded video in the body tab", () => {
    const { container } = render(<StandaloneMediaPreview bodyHtml="" media={[{
      id: "video-1",
      kind: "video",
      src: "https://example.com/video.mp4",
      title: "夏日登录界面",
      note: "",
      path: [],
      altText: "夏日登录界面",
      sortOrder: 10,
      mimeType: "video/mp4"
    }]} />);

    expect(screen.getByRole("region", { name: "正文媒体" })).toBeInTheDocument();
    expect(screen.getByText("夏日登录界面")).toBeInTheDocument();
    expect(container.querySelector("video source")).toHaveAttribute("src", "https://example.com/video.mp4");
  });

  it("does not duplicate media already embedded in rich text", () => {
    const mediaId = "11111111-1111-4111-8111-111111111111";
    const { container } = render(<StandaloneMediaPreview bodyHtml={`<figure data-media-id="${mediaId}"><img src="https://example.com/image.webp"><figcaption></figcaption></figure>`} media={[{
      id: mediaId,
      kind: "image",
      src: "https://example.com/image.webp",
      title: "地图",
      note: "",
      path: [],
      altText: "地图",
      sortOrder: 10
    }]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
