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

  it("keeps table spans and editor column widths", () => {
    const result = sanitizeHtml('<table><tr><td colspan="2" rowspan="2" colwidth="120,120">值</td></tr></table>');
    expect(result).toContain('colspan="2"');
    expect(result).toContain('rowspan="2"');
    expect(result).toContain('colwidth="120,120"');
  });
});
