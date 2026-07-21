import { describe, expect, it } from "vitest";
import { safeUrl, sanitizeHtml, slugify } from "./sanitize";

describe("content sanitization", () => {
  it("removes scripts and event handlers", () => {
    const result = sanitizeHtml('<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="data:image/png;base64,AAAA" onerror="alert(1)">');
    expect(result).toContain("safe");
    expect(result).not.toContain("script");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("data:image");
  });

  it("rejects executable URL schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("http://example.com/image.webp")).toBe("");
    expect(safeUrl("https://example.com/image.webp")).toBe("https://example.com/image.webp");
  });

  it("creates stable Chinese-compatible slugs", () => {
    expect(slugify("BOSS 配套地图")).toBe("boss-配套地图");
  });

  it("keeps only controlled rich-text formatting attributes", () => {
    const result = sanitizeHtml('<p style="text-align:center;position:fixed"><span data-font-family="noto-sans" data-font-size="18" data-text-color="teal" data-unsafe="x">正文</span></p><table data-table-border="3" data-table-style="dashed"><tr><td data-cell-background="teal" data-cell-align="center">单元格</td></tr></table>');
    expect(result).toContain('style="text-align: center"');
    expect(result).not.toContain("position");
    expect(result).toContain('data-font-family="noto-sans"');
    expect(result).toContain('data-font-size="18"');
    expect(result).toContain('data-table-border="3"');
    expect(result).toContain('data-table-style="dashed"');
    expect(result).not.toContain("data-unsafe");
  });

  it("drops unsupported controlled attribute values", () => {
    const result = sanitizeHtml('<span data-font-size="999" data-text-color="expression">内容</span><table data-table-border="99"><tr><td>值</td></tr></table>');
    expect(result).not.toContain("999");
    expect(result).not.toContain("expression");
    expect(result).not.toContain('data-table-border="99"');
  });

  it("keeps safe office-style colors, font sizes and table border colors", () => {
    const result = sanitizeHtml('<span data-font-size="72" data-text-color="#ef4444" style="color:#ef4444;font-size:72px;position:fixed"><mark data-highlight="#fef9c3" style="background-color:#fef9c3">内容</mark></span><table data-table-color="#65e3c2" data-table-border="4" data-table-style="dashed" style="--rich-table-border:4px;--rich-table-style:dashed;--rich-table-color:#65e3c2"><tr><td>值</td></tr></table>');
    expect(result).toContain('data-font-size="72"');
    expect(result).toContain('data-text-color="#ef4444"');
    expect(result).toContain("color: #ef4444");
    expect(result).toContain('data-highlight="#fef9c3"');
    expect(result).toContain('data-table-color="#65e3c2"');
    expect(result).toContain("--rich-table-border: 4px");
    expect(result).toContain("--rich-table-style: dashed");
    expect(result).toContain("--rich-table-color: #65e3c2");
    expect(result).not.toContain("position");
  });

  it("keeps extended controlled table borders", () => {
    const result = sanitizeHtml('<table data-table-border="12" data-table-style="double" style="--rich-table-border: 12px; --rich-table-style: double; --rich-table-color: #65e3c2"><tr><td data-cell-border-width="12" data-cell-border-style="double" data-cell-border-color="#65e3c2">值</td></tr></table>');
    expect(result).toContain('data-table-border="12"');
    expect(result).toContain('data-table-style="double"');
    expect(result).toContain('data-cell-border-width="12"');
    expect(result).toContain('data-cell-border-style="double"');
    expect(result).toContain('data-cell-border-color="#65e3c2"');
    expect(result).toContain("--rich-table-border: 12px");
  });

  it("keeps only valid media identifiers", () => {
    const safe = sanitizeHtml('<figure data-editor-image="true" data-media-id="123e4567-e89b-12d3-a456-426614174000"><img src="https://example.com/a.webp"></figure>');
    const unsafe = sanitizeHtml('<figure data-editor-image="true" data-media-id="not-an-id"><img src="https://example.com/a.webp"></figure>');
    expect(safe).toContain('data-media-id="123e4567-e89b-12d3-a456-426614174000"');
    expect(unsafe).not.toContain("data-media-id");
  });

  it("keeps table spans and editor column widths", () => {
    const result = sanitizeHtml('<table><tr><td colspan="2" rowspan="2" colwidth="120,120">值</td></tr></table>');
    expect(result).toContain('colspan="2"');
    expect(result).toContain('rowspan="2"');
    expect(result).toContain('colwidth="120,120"');
  });

  it("keeps responsive image attributes and rejects unsafe original links", () => {
    const safe = sanitizeHtml('<figure data-original-src="https://cdn.example.com/original.png"><img src="https://cdn.example.com/1600.webp" srcset="https://cdn.example.com/960.webp 960w, https://cdn.example.com/1600.webp 1600w" sizes="(max-width: 720px) 100vw, 1600px" width="1600" height="900"></figure>');
    expect(safe).toContain('srcset="https://cdn.example.com/960.webp 960w, https://cdn.example.com/1600.webp 1600w"');
    expect(safe).toContain('data-original-src="https://cdn.example.com/original.png"');
    const unsafe = sanitizeHtml('<figure data-original-src="javascript:alert(1)"><img src="https://cdn.example.com/1600.webp" srcset="javascript:alert(1) 1600w"></figure>');
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).not.toContain("data-original-src");
  });
});
