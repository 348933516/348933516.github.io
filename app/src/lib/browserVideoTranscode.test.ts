import fs from "node:fs";
import path from "node:path";
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

  it("ships the ESM core required by Vite's module worker", () => {
    const core = fs.readFileSync(path.resolve(process.cwd(), "app/public/ffmpeg/ffmpeg-core.js"), "utf8");
    expect(core).toContain("import.meta.url");
    expect(core).toContain("export default createFFmpegCore");
  });
});
