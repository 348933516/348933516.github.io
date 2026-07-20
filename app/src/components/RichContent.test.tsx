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
});
