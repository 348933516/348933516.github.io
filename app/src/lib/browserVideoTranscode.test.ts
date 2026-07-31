import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
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

  it("loads the versioned runtime from EdgeOne with a local fallback", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "app/src/lib/browserVideoTranscode.ts"), "utf8");
    expect(source).toContain('import { mediaBaseUrl } from "./config"');
    expect(source).toContain('const ffmpegCoreVersion = "0.12.10-r2"');
    expect(source).toContain("ffmpegWasmPartCount = 8");
    expect(source).toContain("loadEdgeWasm(base, onProgress)");
    expect(source).toContain("Promise.all(Array.from");
    expect(source).toContain("URL.createObjectURL(new Blob(parts");
    expect(source).toContain("site/runtime/ffmpeg/${ffmpegCoreVersion}/");
    expect(source).toContain("import.meta.env.BASE_URL}ffmpeg/");
  });

  it("deploys a gzip-compressed immutable runtime to public COS", () => {
    const deployScript = fs.readFileSync(path.resolve(process.cwd(), "scripts/deploy-cos-runtime.mjs"), "utf8");
    const workflow = fs.readFileSync(path.resolve(process.cwd(), ".github/workflows/deploy-supabase.yml"), "utf8");
    expect(deployScript).toContain("gzipSync");
    expect(deployScript).toContain('"content-encoding": "gzip"');
    expect(deployScript).toContain("max-age=31536000, immutable");
    expect(deployScript).toContain("site/runtime/ffmpeg/");
    expect(deployScript).toContain('import https from "node:https"');
    expect(deployScript).toContain('"content-length": String(body.byteLength)');
    expect(deployScript).toContain("request.setTimeout(uploadTimeoutMs");
    expect(deployScript).toContain("maxUploadAttempts = 2");
    expect(deployScript).toContain("wasmPartSize = 4 * 1024 * 1024");
    expect(deployScript).toContain("ffmpeg-core.wasm.part-");
    expect(deployScript).toContain("...wasmParts");
    expect(deployScript).not.toContain("ffmpeg-core.wasm`,");
    expect(deployScript).not.toContain("await fetch(");
    expect(workflow).toContain("node scripts/deploy-cos-runtime.mjs");
  });

  it("splits the WASM into independently compressed COS-safe objects", () => {
    const wasm = fs.readFileSync(path.resolve(process.cwd(), "app/public/ffmpeg/ffmpeg-core.wasm"));
    const partSize = 4 * 1024 * 1024;
    const compressedParts = Array.from({ length: Math.ceil(wasm.byteLength / partSize) }, (_, index) =>
      gzipSync(wasm.subarray(index * partSize, Math.min(wasm.byteLength, (index + 1) * partSize)), { level: 1 })
    );
    expect(compressedParts).toHaveLength(8);
    expect(Math.max(...compressedParts.map((part) => part.byteLength))).toBeLessThan(5 * 1024 * 1024);
    expect(Buffer.concat(compressedParts.map((part) => gunzipSync(part))).equals(wasm)).toBe(true);
  });
});
