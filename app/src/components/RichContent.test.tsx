import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { prepareRichDocument, RichContent } from "./RichContent";

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

  it("uses responsive previews while keeping the original image available", () => {
    const html = '<figure data-editor-image="true" data-original-src="https://example.com/original.png"><img src="https://example.com/1600.webp" srcset="https://example.com/960.webp 960w, https://example.com/1600.webp 1600w" sizes="(max-width: 720px) 100vw, 1600px" width="1600" height="900"><figcaption></figcaption></figure>';
    const { container } = render(<RichContent html={html} />);
    const image = container.querySelector("figure img");
    expect(image).toHaveAttribute("srcset");
    expect(image).toHaveAttribute("width", "1600");
    expect(container.querySelector('figure a[href="https://example.com/original.png"]')?.contains(image)).toBe(true);
  });

  it("collects referenced media while preparing the body in one parse", () => {
    const mediaId = "123e4567-e89b-42d3-a456-426614174000";
    const prepared = prepareRichDocument(`<figure data-editor-image="true" data-media-id="${mediaId}"><img src="https://example.com/image.png"><figcaption></figcaption></figure>`);
    expect(prepared.referencedMediaIds).toEqual(new Set([mediaId]));
    expect(prepared.html).toContain("loading=\"lazy\"");
  });

  it("builds stable unique outline targets for h1 through h4", () => {
    const prepared = prepareRichDocument("<h1>地图展示</h1><h2>可爱风</h2><h2>可爱风</h2><h3>★ 特殊 / 标题</h3><h4>   </h4>");

    expect(prepared.outline.map((item) => [item.label, item.level, item.targetId])).toEqual([
      ["地图展示", 1, "section-地图展示"],
      ["可爱风", 2, "section-可爱风"],
      ["可爱风", 2, "section-可爱风-2"],
      ["★ 特殊 / 标题", 3, "section-特殊-标题"]
    ]);
    const document = new DOMParser().parseFromString(prepared.html, "text/html");
    expect(document.getElementById("section-可爱风-2")?.textContent).toBe("可爱风");
    expect(document.querySelector("h4")?.hasAttribute("id")).toBe(false);
  });
});
