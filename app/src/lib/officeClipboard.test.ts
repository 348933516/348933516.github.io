import { describe, expect, it } from "vitest";
import { normalizeOfficeClipboardHtml, tabSeparatedTextToTableHtml } from "./officeClipboard";

describe("Office clipboard conversion", () => {
  it("keeps safe Word formatting and removes active content and local images", () => {
    const result = normalizeOfficeClipboardHtml(`
      <script>alert(1)</script>
      <p style="font-family: Microsoft YaHei; font-size: 18pt; color: rgb(255, 0, 0); font-weight: bold; text-align: center">标题</p>
      <img src="file:///C:/word/image.png" alt="local">
    `);
    expect(result).toContain('data-font-family="yahei"');
    expect(result).toContain('data-font-size="24"');
    expect(result).toContain('data-text-color="#ff0000"');
    expect(result).toContain("<strong>标题</strong>");
    expect(result).not.toContain("script");
    expect(result).not.toContain("file://");
  });

  it("preserves Excel merged cells, fills and controlled borders", () => {
    const result = normalizeOfficeClipboardHtml('<table><tr><td colspan="2" style="background-color:#ffeeaa;border-color:#336699;text-align:right">合并</td></tr></table>');
    expect(result).toContain('colspan="2"');
    expect(result).toContain('data-cell-background="#ffeeaa"');
    expect(result).toContain('data-cell-align="right"');
    expect(result).toContain('data-cell-border-color="#336699"');
    expect(result).toContain('data-table-style="solid"');
  });

  it("turns tab-separated spreadsheet text into an editable table", () => {
    const result = tabSeparatedTextToTableHtml("名称\t等级\n测试地图\t200");
    expect(result).toContain("<table");
    expect(result).toContain("<th");
    expect(result).toContain("测试地图");
    expect(result).toContain('data-cell-border-width="1"');
  });
});

