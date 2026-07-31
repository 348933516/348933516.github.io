import { corsHeaders, edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { copyCosObject, cosConfiguration, CosRequestError, deleteCosObject, signedCosObjectUrl } from "../_shared/tencent-cos.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function replacementFailure(stage: string, error: unknown) {
  const requestId = crypto.randomUUID();
  if (error instanceof CosRequestError) {
    console.error(`[video-replacement:${requestId}]`, JSON.stringify({
      stage,
      operation: error.operation,
      code: error.code,
      httpStatus: error.httpStatus,
      cosRequestId: error.requestId,
      bucket: error.bucket
    }));
    const status = error.httpStatus === 403 ? 502 : 500;
    const requestDetail = error.requestId ? `, COS request ID ${error.requestId}` : "";
    return json({
      error: `Video replacement failed during ${stage}: COS ${error.operation} returned ${error.code}${requestDetail}.`,
      code: "VIDEO_REPLACEMENT_COS_FAILED",
      stage,
      operation: error.operation,
      http_status: error.httpStatus,
      cos_request_id: error.requestId,
      request_id: requestId
    }, status);
  }
  console.error(`[video-replacement:${requestId}]`, JSON.stringify({
    stage,
    errorType: error instanceof Error ? error.name : typeof error
  }));
  return json({
    error: `Video replacement failed during ${stage}. Request ID ${requestId}.`,
    code: "VIDEO_REPLACEMENT_FAILED",
    stage,
    request_id: requestId
  }, 500);
}

async function handleAdmin(request: Request, body: Record<string, unknown>) {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const action = String(body.action || "status");
  const contentId = String(body.contentId || "");
  if (!uuid.test(contentId)) return json({ error: "Invalid content ID" }, 400);
  const { data: content } = await client.from("contents").select("id,created_by,status").eq("id", contentId).maybeSingle();
  if (!content) return json({ error: "Content not found" }, 404);
  if (profile.role === "uploader" && content.created_by !== user.id) return json({ error: "Not allowed to manage this video" }, 403);

  const mediaId = String(body.mediaId || "");
  if (!uuid.test(mediaId)) return json({ error: "Invalid media ID" }, 400);
  const { data: media } = await client.from("content_media").select("*").eq("id", mediaId).eq("content_id", contentId).maybeSingle();
  if (!media) return json({ error: "Media was not found" }, 404);

  if (action === "commit-replacement") {
    let stage = "configuration";
    try {
    const configuration = cosConfiguration();
    if (media.pending_storage_provider !== "tencent_cos" || media.pending_storage_bucket !== configuration.privateBucket || !media.pending_storage_path) return json({ error: "No verified replacement is pending" }, 409);
    if (!String(media.pending_storage_path).startsWith(`drafts/${contentId}/`)) return json({ error: "Invalid replacement object path" }, 400);
    const pendingSizeBytes = Number(media.pending_size_bytes || 0);
    const pendingContentType = String(media.pending_mime_type || "");
    if (pendingSizeBytes <= 0 || (media.kind === "video" && !pendingContentType.startsWith("video/"))) return json({ error: "Replacement object metadata is invalid" }, 422);
    const pendingPosterPath = String(body.posterPath || "");
    if (pendingPosterPath && (!pendingPosterPath.startsWith(`drafts/${contentId}/`) || pendingPosterPath === media.pending_storage_path)) return json({ error: "Invalid replacement poster path" }, 400);
    const published = content.status === "published";
    const destinationBucket = published ? configuration.publicBucket : media.pending_storage_bucket;
    const destinationPath = published
      ? `content/${contentId}/content_media/${mediaId}/${crypto.randomUUID()}-${String(media.pending_storage_path).split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || "media"}`
      : media.pending_storage_path;
    const destinationPosterPath = pendingPosterPath
      ? published
        ? `content/${contentId}/content_media/${mediaId}/${crypto.randomUUID()}-poster.webp`
        : pendingPosterPath
      : null;
    const copiedPaths: string[] = [];
    if (published) {
      try {
        stage = "copy-video";
        await copyCosObject(media.pending_storage_bucket, media.pending_storage_path, destinationBucket, destinationPath, {
          cacheControl: media.kind === "video" ? "public, max-age=2592000, immutable" : "public, max-age=31536000, immutable",
          sourceContentType: pendingContentType,
          verifyDestination: false
        });
        copiedPaths.push(destinationPath);
        if (pendingPosterPath && destinationPosterPath) {
          stage = "copy-poster";
          await copyCosObject(configuration.privateBucket, pendingPosterPath, destinationBucket, destinationPosterPath, {
            cacheControl: "public, max-age=31536000, immutable",
            sourceContentType: "image/webp",
            verifyDestination: false
          });
          copiedPaths.push(destinationPosterPath);
        }
      } catch (error) {
        await Promise.allSettled(copiedPaths.map((path) => deleteCosObject(destinationBucket, path)));
        throw error;
      }
    }
    const oldBucket = media.storage_bucket;
    const oldPaths = [...new Set([
      media.storage_path,
      media.original_storage_path,
      media.display_storage_path,
      media.poster_storage_path,
      ...(Array.isArray(media.image_variants) ? media.image_variants.map((variant: Record<string, unknown>) => String(variant.path || "")) : [])
    ].filter(Boolean).map(String))];
    const requestedCodec = String(body.videoCodec || "");
    const videoCodec = requestedCodec === "h264+aac" ? requestedCodec : "browser-compatible";
    const durationMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.round(Number(body.durationMs || 0))));
    const posterUrl = published && destinationPosterPath
      ? `${configuration.mediaBaseUrl}/${destinationPosterPath.split("/").map(encodeURIComponent).join("/")}`
      : null;
    stage = "commit-database";
    const { error: updateError } = await client.from("content_media").update({
      storage_provider: "tencent_cos",
      storage_bucket: destinationBucket,
      storage_path: destinationPath,
      original_storage_path: null,
      display_storage_path: null,
      image_variants: [],
      mime_type: pendingContentType,
      size_bytes: pendingSizeBytes,
      width: media.pending_width || media.width,
      height: media.pending_height || media.height,
      processing_status: "ready",
      video_codec: media.kind === "video" ? videoCodec : null,
      duration_ms: media.kind === "video" && durationMs ? durationMs : media.duration_ms,
      playback_url: null,
      poster_url: posterUrl,
      poster_storage_path: destinationPosterPath,
      pending_storage_provider: null,
      pending_storage_bucket: null,
      pending_storage_path: null,
      pending_mime_type: null,
      pending_size_bytes: null,
      pending_width: null,
      pending_height: null
    }).eq("id", mediaId).eq("content_id", contentId);
    if (updateError) {
      if (published) await Promise.allSettled(copiedPaths.map((path) => deleteCosObject(destinationBucket, path)));
      return json({ error: "Unable to commit replacement" }, 500);
    }
    const obsolete = [
      ...oldPaths.map((path) => ({ bucket: oldBucket, path })),
      published ? { bucket: media.pending_storage_bucket, path: media.pending_storage_path } : null,
      published && pendingPosterPath ? { bucket: configuration.privateBucket, path: pendingPosterPath } : null
    ].filter((item): item is { bucket: string; path: string } => Boolean(item?.bucket && item?.path && !(item.bucket === destinationBucket && item.path === destinationPath)));
    await Promise.allSettled(obsolete.map((item) => deleteCosObject(item.bucket, item.path)));
    stage = "build-preview";
    const previewUrl = published
      ? `${configuration.mediaBaseUrl}/${destinationPath.split("/").map(encodeURIComponent).join("/")}`
      : await signedCosObjectUrl(destinationBucket, destinationPath);
    const posterPreviewUrl = destinationPosterPath
      ? published
        ? posterUrl
        : await signedCosObjectUrl(destinationBucket, destinationPosterPath)
      : null;
    return json({ ok: true, previewUrl, posterUrl: posterPreviewUrl, storageBucket: destinationBucket, storagePath: destinationPath, posterStoragePath: destinationPosterPath, mimeType: pendingContentType, sizeBytes: pendingSizeBytes });
    } catch (error) {
      return replacementFailure(stage, error);
    }
  }

  return json({ error: "Unsupported admin action" }, 400);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  return edgeHandler(request, () => handleAdmin(request, body));
});
