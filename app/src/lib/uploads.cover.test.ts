import { describe, expect, it } from "vitest";
import { squareCropGeometry } from "./uploads";

describe("cover image cropping", () => {
  it("centers a landscape image and caps the output at the source square", () => {
    expect(squareCropGeometry(1920, 1080, 960)).toEqual({
      sourceX: 420,
      sourceY: 0,
      sourceSize: 1080,
      outputSize: 960
    });
  });

  it("centers a portrait image without enlarging a small source", () => {
    expect(squareCropGeometry(320, 640, 960)).toEqual({
      sourceX: 0,
      sourceY: 160,
      sourceSize: 320,
      outputSize: 320
    });
  });

  it("keeps zero-sized image metadata from creating an invalid canvas", () => {
    expect(squareCropGeometry(0, 0, 480)).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceSize: 1,
      outputSize: 1
    });
  });
});
