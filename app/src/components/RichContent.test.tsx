import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichContent } from "./RichContent";

describe("rich content reader", () => {
  it("wraps each table in a responsive scrolling region", () => {
    const { container } = render(<RichContent html="<p>正文</p><table><tr><td>值</td></tr></table>" />);
    expect(container.querySelector(".rich-table-scroll > table")).toBeInTheDocument();
  });
});
