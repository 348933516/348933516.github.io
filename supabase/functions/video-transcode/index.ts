import { adminClient, corsHeaders, edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { copyCosObject, cosConfiguration, deleteCosObject, headCosObject, signedCosObjectUrl, signedCosUploadUrl } from "../_shared/tencent-cos.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activeStatuses = ["queued", "claimed", "transcoding", "uploading", "verifying"];

function cleanError(value: unknown) {
  return String(value || "Video transcoding failed").replace(/https?:\/\/\S+/g, "[url]").replace(/\s+/g, " ").slice(0, 500);
}

function workerAuthorized(request: Request) {
  const expected = Deno.env.get("VIDEO_WORKER_TOKEN") || "";
  const supplied = request.headers.get("x-video-worker-token") || "";
  if (!expected || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}

async function handleWorker(body: Record<string, unknown>) {
  const client = adminClient();
  const action = String(body.action || "claim");
  const workerId = String(body.workerId || "maplestorynk-worker").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  const configuration = cosConfiguration();

  if (action === "claim") {
    const { data, error } = await client.rpc("claim_video_transcode_job", { p_worker_id: workerId });
    if (error) return json({ error: "Unable to claim a transcode job" }, 500);
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return json({ job: null, retryAfterSeconds: 10 });
    if (job.input_provider !== "tencent_cos") {
      await client.from("video_transcode_jobs").update({ status: "failed", error_code: "UNSUPPORTED_INPUT_PROVIDER", error_message: "Worker input must be stored in COS", updated_at: new Date().toISOString() }).eq("id", job.id);
      return json({ job: null, retryAfterSeconds: 1 });
    }
    return json({
      job: {
        id: job.id,
        mediaId: job.media_id,
        inputSizeBytes: Number(job.input_size_bytes || 0),
        inputUrl: await signedCosObjectUrl(job.input_bucket, job.input_path)
      }
    });
  }

  const jobId = String(body.jobId || "");
  if (!uuid.test(jobId)) return json({ error: "Invalid job ID" }, 400);
  const { data: job } = await client.from("video_transcode_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job || job.worker_id !== workerId) return json({ error: "Transcode job is not owned by this worker" }, 409);
  if (job.status === "completed" && action === "complete") return json({ ok: true, alreadyCompleted: true });
  if (job.status === "completed" && action === "fail") return json({ ok: true, alreadyCompleted: true });
  if (!activeStatuses.includes(String(job.status))) return json({ error: "Transcode job is no longer active" }, 409);

  if (action === "upload-urls") {
    return json({
      output: await signedCosUploadUrl(job.output_bucket, job.output_path, "video/mp4", "public, max-age=2592000, immutable"),
      poster: await signedCosUploadUrl(job.output_bucket, job.poster_path, "image/webp", "public, max-age=31536000, immutable")
    });
  }

  if (action === "heartbeat") {
    const status = ["claimed", "transcoding", "uploading", "verifying"].includes(String(body.status)) ? String(body.status) : "transcoding";
    const progress = Math.max(0, Math.min(99, Math.round(Number(body.progress || 0))));
    const { error } = await client.from("video_transcode_jobs").update({ status, progress, heartbeat_at: new Date().toISOString(), lease_expires_at: new Date(Date.now() + 180_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId).eq("worker_id", workerId);
    return error ? json({ error: "Heartbeat rejected" }, 409) : json({ ok: true });
  }

  if (action === "fail") {
    const errorCode = String(body.errorCode || "FFMPEG_FAILED").replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80);
    const { data: failed, error: failError } = await client.from("video_transcode_jobs")
      .update({ status: "failed", progress: 0, error_code: errorCode, error_message: cleanError(body.errorMessage), lease_expires_at: null, updated_at: new Date().toISOString() })
      .eq("id", jobId).eq("worker_id", workerId).in("status", activeStatuses).select("id").maybeSingle();
    if (failError) return json({ error: "Unable to record transcode failure" }, 500);
    if (failed) {
      const { data: media } = await client.from("content_media").select("storage_path,pending_storage_path").eq("id", job.media_id).maybeSingle();
      const hasPlayableFallback = Boolean(media?.storage_path && media.pending_storage_path && media.storage_path !== media.pending_storage_path);
      await client.from("content_media").update({ processing_status: hasPlayableFallback ? "ready" : "failed" }).eq("id", job.media_id);
    }
    return json({ ok: true });
  }

  if (action === "complete") {
    const [output, poster] = await Promise.all([
      headCosObject(job.output_bucket, job.output_path),
      headCosObject(job.output_bucket, job.poster_path)
    ]);
    if (output.sizeBytes <= 0 || poster.sizeBytes <= 0) return json({ error: "Transcoded output verification failed" }, 422);
    const durationMs = Math.max(0, Math.round(Number(body.durationMs || 0)));
    const { data: currentMedia } = await client.from("content_media").select("storage_provider,storage_bucket,storage_path,pending_storage_path").eq("id", job.media_id).maybeSingle();
    if (!currentMedia) {
      await Promise.allSettled([deleteCosObject(job.output_bucket, job.output_path), deleteCosObject(job.output_bucket, job.poster_path)]);
      return json({ error: "Media was deleted before transcoding completed" }, 410);
    }
    const isPublic = job.output_bucket === configuration.publicBucket;
    const { data: committedMedia, error: mediaError } = await client.from("content_media").update({
      storage_provider: "tencent_cos",
      storage_bucket: job.output_bucket,
      storage_path: job.output_path,
      poster_storage_path: job.poster_path,
      mime_type: "video/mp4",
      size_bytes: output.sizeBytes,
      video_codec: "h264",
      duration_ms: durationMs || null,
      processing_status: "ready",
      playback_url: null,
      poster_url: isPublic ? `${configuration.mediaBaseUrl}/${String(job.poster_path).split("/").map(encodeURIComponent).join("/")}` : null,
      pending_storage_provider: null,
      pending_storage_bucket: null,
      pending_storage_path: null,
      pending_mime_type: null,
      pending_size_bytes: null,
      pending_width: null,
      pending_height: null
    }).eq("id", job.media_id).eq("content_id", job.content_id).select("id").maybeSingle();
    if (mediaError || !committedMedia) return json({ error: "Unable to commit transcoded media" }, 500);
    const { error: jobError } = await client.from("video_transcode_jobs").update({ status: "completed", progress: 100, output_size_bytes: output.sizeBytes, output_codec: "h264+aac", duration_ms: durationMs || null, lease_expires_at: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId).in("status", activeStatuses);
    if (jobError) return json({ error: "Unable to complete transcode job" }, 500);
    const obsolete = [
      { bucket: job.input_bucket, path: job.input_path },
      { bucket: currentMedia?.storage_bucket, path: currentMedia?.storage_path }
    ].filter((item, index, items) => item.bucket && item.path && !(item.bucket === job.output_bucket && item.path === job.output_path) && items.findIndex((candidate) => candidate.bucket === item.bucket && candidate.path === item.path) === index);
    await Promise.allSettled(obsolete.map((item) => deleteCosObject(String(item.bucket), String(item.path))));
    return json({ ok: true, outputSizeBytes: output.sizeBytes, posterSizeBytes: poster.sizeBytes, bucket: job.output_bucket });
  }

  return json({ error: "Unsupported worker action" }, 400);
}

async function handleAdmin(request: Request, body: Record<string, unknown>) {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const action = String(body.action || "status");
  const contentId = String(body.contentId || "");
  if (!uuid.test(contentId)) return json({ error: "Invalid content ID" }, 400);
  const { data: content } = await client.from("contents").select("id,created_by,status").eq("id", contentId).maybeSingle();
  if (!content) return json({ error: "Content not found" }, 404);
  if (profile.role === "uploader" && content.created_by !== user.id) return json({ error: "Not allowed to manage this video" }, 403);

  if (action === "status") {
    const { data, error } = await client.from("video_transcode_jobs").select("id,media_id,status,progress,attempt_count,input_codec,output_codec,input_size_bytes,output_size_bytes,duration_ms,error_code,error_message,updated_at").eq("content_id", contentId).order("created_at", { ascending: false }).limit(100);
    return error ? json({ error: "Unable to read transcode status" }, 500) : json({ jobs: data || [] });
  }

  const mediaId = String(body.mediaId || "");
  if (!uuid.test(mediaId)) return json({ error: "Invalid media ID" }, 400);
  const { data: media } = await client.from("content_media").select("*").eq("id", mediaId).eq("content_id", contentId).maybeSingle();
  if (!media) return json({ error: "Media was not found" }, 404);

  if (action === "commit-replacement") {
    const configuration = cosConfiguration();
    if (media.pending_storage_provider !== "tencent_cos" || media.pending_storage_bucket !== configuration.privateBucket || !media.pending_storage_path) return json({ error: "No verified replacement is pending" }, 409);
    const pending = await headCosObject(media.pending_storage_bucket, media.pending_storage_path);
    if (pending.sizeBytes <= 0 || pending.sizeBytes !== Number(media.pending_size_bytes || 0)) return json({ error: "Replacement object verification failed" }, 422);
    const published = content.status === "published";
    const destinationBucket = published ? configuration.publicBucket : media.pending_storage_bucket;
    const destinationPath = published
      ? `content/${contentId}/content_media/${mediaId}/${crypto.randomUUID()}-${String(media.pending_storage_path).split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || "media"}`
      : media.pending_storage_path;
    if (published) {
      await copyCosObject(media.pending_storage_bucket, media.pending_storage_path, destinationBucket, destinationPath, {
        cacheControl: media.kind === "video" ? "public, max-age=2592000, immutable" : "public, max-age=31536000, immutable"
      });
    }
    const oldBucket = media.storage_bucket;
    const oldPaths = [...new Set([
      media.storage_path,
      media.original_storage_path,
      media.display_storage_path,
      media.poster_storage_path,
      ...(Array.isArray(media.image_variants) ? media.image_variants.map((variant: Record<string, unknown>) => String(variant.path || "")) : [])
    ].filter(Boolean).map(String))];
    const { error: updateError } = await client.from("content_media").update({
      storage_provider: "tencent_cos",
      storage_bucket: destinationBucket,
      storage_path: destinationPath,
      original_storage_path: null,
      display_storage_path: null,
      image_variants: [],
      mime_type: media.pending_mime_type || pending.contentType,
      size_bytes: pending.sizeBytes,
      width: media.pending_width || media.width,
      height: media.pending_height || media.height,
      processing_status: "ready",
      video_codec: media.kind === "video" ? "browser-compatible" : null,
      playback_url: null,
      poster_url: null,
      poster_storage_path: null,
      pending_storage_provider: null,
      pending_storage_bucket: null,
      pending_storage_path: null,
      pending_mime_type: null,
      pending_size_bytes: null,
      pending_width: null,
      pending_height: null
    }).eq("id", mediaId).eq("content_id", contentId);
    if (updateError) {
      if (published) await deleteCosObject(destinationBucket, destinationPath).catch(() => undefined);
      return json({ error: "Unable to commit replacement" }, 500);
    }
    const obsolete = [
      ...oldPaths.map((path) => ({ bucket: oldBucket, path })),
      published ? { bucket: media.pending_storage_bucket, path: media.pending_storage_path } : null
    ].filter((item): item is { bucket: string; path: string } => Boolean(item?.bucket && item?.path && !(item.bucket === destinationBucket && item.path === destinationPath)));
    await Promise.allSettled(obsolete.map((item) => deleteCosObject(item.bucket, item.path)));
    const previewUrl = published
      ? `${configuration.mediaBaseUrl}/${destinationPath.split("/").map(encodeURIComponent).join("/")}`
      : await signedCosObjectUrl(destinationBucket, destinationPath);
    return json({ ok: true, previewUrl, storageBucket: destinationBucket, storagePath: destinationPath, mimeType: media.pending_mime_type || pending.contentType, sizeBytes: pending.sizeBytes });
  }

  if (media.kind !== "video") return json({ error: "This operation requires video media" }, 409);

  if (action === "retry") {
    const { data: active } = await client.from("video_transcode_jobs").select("id,status,progress").eq("media_id", mediaId).in("status", activeStatuses).limit(1).maybeSingle();
    if (active) return json(active);
    const { data: failed } = await client.from("video_transcode_jobs").select("id").eq("media_id", mediaId).eq("status", "failed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!failed) return json({ error: "No failed job can be retried" }, 409);
    const { error: retryError } = await client.from("video_transcode_jobs").update({ status: "queued", progress: 0, worker_id: null, lease_expires_at: null, error_code: null, error_message: null, updated_at: new Date().toISOString() }).eq("id", failed.id).eq("status", "failed");
    if (retryError) return json({ error: "Unable to retry the transcode job" }, 500);
    const { error: mediaError } = await client.from("content_media").update({ processing_status: "processing" }).eq("id", mediaId);
    if (mediaError) return json({ error: "Unable to update video processing status" }, 500);
    return json({ id: failed.id, status: "queued" });
  }

  if (action === "enqueue") {
    const inputProvider = media.pending_storage_provider || media.storage_provider;
    const inputBucket = media.pending_storage_bucket || media.storage_bucket;
    const inputPath = media.pending_storage_path || media.storage_path;
    const inputSize = Number(media.pending_size_bytes || media.size_bytes || 0);
    if (inputProvider !== "tencent_cos" || inputBucket !== cosConfiguration().privateBucket || !inputPath) return json({ error: "Video source must be in the private COS bucket" }, 409);
    if (inputSize > 1024 * 1024 * 1024) return json({ error: "Video exceeds the 1GB transcode limit" }, 413);
    const { data: active } = await client.from("video_transcode_jobs").select("id,status,progress").eq("media_id", mediaId).in("status", activeStatuses).limit(1).maybeSingle();
    if (active) return json(active);
    const jobId = crypto.randomUUID();
    const { data: job, error } = await client.from("video_transcode_jobs").insert({
      id: jobId,
      media_id: mediaId,
      content_id: contentId,
      input_provider: inputProvider,
      input_bucket: inputBucket,
      input_path: inputPath,
      input_size_bytes: inputSize,
      output_bucket: content.status === "published" ? cosConfiguration().publicBucket : cosConfiguration().privateBucket,
      output_path: content.status === "published" ? `content/${contentId}/content_media/${mediaId}/${jobId}.mp4` : `drafts/${contentId}/transcodes/${jobId}.mp4`,
      poster_path: content.status === "published" ? `content/${contentId}/content_media/${mediaId}/${jobId}.webp` : `drafts/${contentId}/transcodes/${jobId}.webp`,
      input_codec: String(body.inputCodec || media.video_codec || "unknown").slice(0, 80),
      created_by: user.id
    }).select("id,status,progress").single();
    if (error || !job) return json({ error: "Unable to enqueue video transcoding" }, 500);
    await client.from("content_media").update({ processing_status: "processing", placement_status: media.placement_status || "unplaced" }).eq("id", mediaId);
    return json(job, 201);
  }

  return json({ error: "Unsupported admin action" }, 400);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (["claim", "heartbeat", "upload-urls", "complete", "fail"].includes(String(body.action || ""))) {
    if (!workerAuthorized(request)) return json({ error: "Worker authentication failed" }, 401);
    try { return await handleWorker(body); } catch (error) { console.error("video-transcode-worker", cleanError(error)); return json({ error: "Worker request failed" }, 500); }
  }
  return edgeHandler(request, () => handleAdmin(request, body));
});
