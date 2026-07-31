import { describe, expect, it } from "vitest";
import { browserVideoTranscodeLimit, buildVideoTranscodeArguments } from "./browserVideoTranscode";

describe("browser video transcode", () => {
  it("uses a lower local limit on low-memory devices", () => {
    expect(browserVideoTranscodeLimit(2)).toBe(128 * 1024 * 1024);
    expect(browserVideoTranscodeLimit(4)).toBe(300 * 1024 * 1024);
    expect(browserVideoTranscodeLimit()).toBe(300 * 1024 * 1024);
  });

  it("builds an H.264 AAC fast-start conversion", () => {
    const argumentsList = buildVideoTranscodeArguments("source.avi", "compatible.mp4");
    expect(argumentsList).toContain("libx264");
    expect(argumentsList).toContain("aac");
    expect(argumentsList).toContain("yuv420p");
    expect(argumentsList).toContain("+faststart");
    expect(argumentsList.at(-1)).toBe("compatible.mp4");
  });
});
