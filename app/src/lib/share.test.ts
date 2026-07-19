import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShareUrl, copyShareUrl } from "./share";

describe("share links", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds a stable hash-router URL without the cache version", () => {
    expect(buildShareUrl("/content/first", "http://maplestorynk.online/preview/?v=626861f#/content/old"))
      .toBe("http://maplestorynk.online/preview/#/content/first");
  });

  it("falls back to a temporary textarea when clipboard is unavailable", async () => {
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => true) });
    const execute = vi.spyOn(document, "execCommand").mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await expect(copyShareUrl("http://maplestorynk.online/preview/#/content/first")).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea[data-share-copy]")).toBeNull();
  });
});
