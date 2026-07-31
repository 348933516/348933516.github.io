import { describe, expect, it } from "vitest";
import { messageOf } from "./shared";

describe("admin error messages", () => {
  it("keeps string rejections from browser workers readable", () => {
    expect(messageOf("Error: failed to import ffmpeg-core.js")).toBe("Error: failed to import ffmpeg-core.js");
    expect(messageOf({ message: "FFmpeg worker failed" })).toBe("FFmpeg worker failed");
  });
});
