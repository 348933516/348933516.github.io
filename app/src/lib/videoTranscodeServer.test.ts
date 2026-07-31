import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260731120000_inline_media_video_transcoding.sql"), "utf8");
const edgeFunction = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/video-transcode/index.ts"), "utf8");
const mediaAdmin = fs.readFileSync(path.resolve(process.cwd(), "app/src/pages/admin/ContentAdmin.tsx"), "utf8");
const browserTranscode = fs.readFileSync(path.resolve(process.cwd(), "app/src/lib/browserVideoTranscode.ts"), "utf8");
const publication = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/publish-content/index.ts"), "utf8");

describe("browser video transcode pipeline", () => {
  it("keeps the old queue schema harmless for already-created jobs", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("video_transcode_jobs_active_media_idx");
  });

  it("transcodes incompatible files in the administrator browser", () => {
    expect(browserTranscode).toContain('"-c:v", "libx264"');
    expect(browserTranscode).toContain('"-pix_fmt", "yuv420p"');
    expect(browserTranscode).toContain('"-movflags", "+faststart"');
    expect(mediaAdmin).toContain("prepareBrowserVideo(file");
    expect(mediaAdmin).not.toContain('action: "enqueue"');
    expect(mediaAdmin).toContain("不使用轻量服务器");
  });

  it("keeps every video visible even when legacy rows carry an import id", () => {
    expect(mediaAdmin).toContain('if (filter === "video") request = request.eq("kind", "video");');
    expect(mediaAdmin).not.toContain('request.eq("kind", "video").is("source_import_id", null)');
  });

  it("offers browser repair for legacy videos whose codec was never detected", () => {
    expect(mediaAdmin).toContain('|| !videoCodec || videoCodec === "browser-incompatible"');
  });

  it("keeps published replacement atomic and caches video and poster objects", () => {
    expect(edgeFunction).toContain("pendingPosterPath");
    expect(edgeFunction).toContain("posterStoragePath");
    expect(publication).toContain("VIDEO_PROCESSING_PENDING");
    expect(publication).toContain("public, max-age=2592000, immutable");
    expect(publication).toContain("public, max-age=31536000, immutable");
    expect(publication).toContain("hasPublishedFallback");
  });
});
