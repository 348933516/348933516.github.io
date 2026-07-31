import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260731120000_inline_media_video_transcoding.sql"), "utf8");
const edgeFunction = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/video-transcode/index.ts"), "utf8");
const worker = fs.readFileSync(path.resolve(process.cwd(), "workers/video-transcode/worker.py"), "utf8");
const publication = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/publish-content/index.ts"), "utf8");

describe("outbound video transcode pipeline", () => {
  it("uses an atomic leased queue with one active job per media item", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("video_transcode_jobs_active_media_idx");
    expect(migration).toContain("lease_expires_at");
    expect(edgeFunction).toContain('action === "heartbeat"');
  });

  it("never stores permanent cloud credentials in the worker", () => {
    expect(worker).toContain("x-video-worker-token");
    expect(worker).toContain("VIDEO_TRANSCODE_ENDPOINT");
    expect(worker).not.toContain("SERVICE_ROLE");
    expect(worker).not.toContain("SECRET_KEY");
    expect(worker).toContain('"-c:v", "libx264"');
    expect(worker).toContain('"yuv420p"');
    expect(worker).toContain('"+faststart"');
    expect(worker).toContain('heartbeat(job_id, "claimed", 0)');
    expect(worker).toContain('heartbeat(job_id, "uploading", 96)');
    expect(worker).toContain("clean_error(error)");
    expect(worker).toContain('"[url]"');
  });

  it("blocks publication while a video is unfinished and replaces no-store metadata", () => {
    expect(publication).toContain("VIDEO_PROCESSING_PENDING");
    expect(publication).toContain("public, max-age=2592000, immutable");
    expect(publication).toContain("public, max-age=31536000, immutable");
    expect(publication).toContain("hasPublishedFallback");
  });

  it("keeps completion idempotent and preserves an old playable replacement", () => {
    expect(edgeFunction).toContain('job.status === "completed" && action === "complete"');
    expect(edgeFunction).toContain("hasPlayableFallback ? \"ready\" : \"failed\"");
    expect(edgeFunction).toContain("Media was deleted before transcoding completed");
  });
});
