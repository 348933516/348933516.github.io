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
});
