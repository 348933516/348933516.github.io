import { describe, expect, it } from "vitest";
import { normalizeCarouselTarget } from "./carousel";

describe("carousel target safety", () => {
  it("allows only public internal content and category routes", () => {
    expect(normalizeCarouselTarget("/content/first")).toBe("/content/first");
    expect(normalizeCarouselTarget("/category/wz?from=home")).toBe("/category/wz?from=home");
  });

  it("blocks admin, login, preview and external targets", () => {
    expect(normalizeCarouselTarget("/admin/settings")).toBe("");
    expect(normalizeCarouselTarget("/login")).toBe("");
    expect(normalizeCarouselTarget("/preview/")).toBe("");
    expect(normalizeCarouselTarget("https://example.com/content/first")).toBe("");
  });
});

