import { afterEach, describe, expect, it, vi } from "vitest";
import { centeredSquareCrop, cropFaviconToPng, DEFAULT_FAVICON_URL, syncSiteFavicon } from "./favicon";

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelector("#site-favicon")?.remove();
});

describe("site favicon", () => {
  it("calculates a centered square crop", () => {
    expect(centeredSquareCrop(120, 80)).toEqual({ x: 20, y: 0, side: 80 });
    expect(centeredSquareCrop(50, 90)).toEqual({ x: 0, y: 20, side: 50 });
  });

  it("renders a centered 32x32 PNG", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 120, height: 80, close })));
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ clearRect: vi.fn(), drawImage })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" })))
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === "canvas") return canvas as unknown as HTMLCanvasElement;
      return createElement(tagName, options);
    }) as typeof document.createElement);

    const output = await cropFaviconToPng(new File(["image"], "wide.jpg", { type: "image/jpeg" }));

    expect(output.type).toBe("image/png");
    expect(output.name).toBe("favicon-32.png");
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(32);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 20, 0, 80, 80, 0, 0, 32, 32);
    expect(close).toHaveBeenCalledOnce();
  });

  it("restores the bundled SVG when the custom icon is removed", () => {
    syncSiteFavicon("https://media.example/favicon.png");
    expect(document.querySelector<HTMLLinkElement>("#site-favicon")?.type).toBe("image/png");
    syncSiteFavicon();
    const link = document.querySelector<HTMLLinkElement>("#site-favicon");
    expect(link?.type).toBe("image/svg+xml");
    expect(link?.getAttribute("href")).toBe(DEFAULT_FAVICON_URL);
  });

  it("falls back to the bundled SVG when the configured icon cannot load", () => {
    syncSiteFavicon("https://media.example/missing.png");
    const link = document.querySelector<HTMLLinkElement>("#site-favicon");
    link?.dispatchEvent(new Event("error"));
    expect(link?.type).toBe("image/svg+xml");
    expect(link?.getAttribute("href")).toBe(DEFAULT_FAVICON_URL);
  });
});
