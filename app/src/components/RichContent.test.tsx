import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichContent } from "./RichContent";

describe("rich content reader", () => {
  it("wraps each table in a responsive scrolling region", () => {
    const { container } = render(<RichContent html={'<p>正文</p><img src="https://example.com/map.png"><table><tr><td>值</td></tr></table>'} />);
    expect(container.querySelector(".rich-table-scroll > table")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(container.querySelector("img")).toHaveAttribute("decoding", "async");
  });

  it("removes raw images duplicated by an imported media figure", () => {
    const mediaId = "123e4567-e89b-42d3-a456-426614174000";
    const html = `<figure data-editor-image="true" data-media-id="${mediaId}"><img src="https://example.com/imported.png" alt="图片 1"></figure><img src="https://example.com/imported.png" alt="图片 1"><img src="https://example.com/independent.png" alt="独立图片">`;
    const { container } = render(<RichContent html={html} />);

    expect(container.querySelectorAll('img[src="https://example.com/imported.png"]')).toHaveLength(1);
    expect(container.querySelectorAll('img[src="https://example.com/independent.png"]')).toHaveLength(1);
  });
});
