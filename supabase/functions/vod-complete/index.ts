import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { functionError } from "../_shared/function-errors.ts";

function safeHttps(value: unknown) {
  const normalized = String(value || "").replace(/^http:/i, "https:");
  return /^https:\/\//i.test(normalized) ? normalized : null;
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  if (Deno.env.get("TENCENT_VOD_ENABLED") !== "true") {
    return json(functionError("VOD_DISABLED", "VOD is disabled; upload compatible videos to COS", "complete"), 409);
  }
  const body = await request.json();
  const contentId = String(body.contentId || "");
  const fileId = String(body.fileId || "");
  const appId = Number(body.appId || 0);
  if (!contentId || !fileId || !appId) return json(functionError("VIDEO_RESULT_INVALID", "Video upload result is incomplete", "complete"), 400);
  const { data: content } = await client.from("contents").select("id, status, created_by").eq("id", contentId).maybeSingle();
  if (!content) return json(functionError("CONTENT_NOT_FOUND", "Content does not exist", "complete"), 404);
  if (profile.role === "uploader" && (content.status !== "draft" || content.created_by !== user.id)) return json(functionError("ROLE_FORBIDDEN", "Content update is not allowed", "complete"), 403);
  const values = {
    content_id: contentId,
    kind: "video",
    storage_bucket: null,
    storage_path: null,
    external_url: safeHttps(body.playbackUrl),
    title: String(body.title || "视频").slice(0, 200),
    alt_text: String(body.title || "视频").slice(0, 200),
    mime_type: String(body.mimeType || "video/mp4").slice(0, 100),
    size_bytes: Math.max(0, Number(body.sizeBytes || 0)),
    original_size_bytes: Math.max(0, Number(body.sizeBytes || 0)),
    sort_order: Number(body.sortOrder || 100),
    video_provider: "tencent_vod",
    provider_file_id: fileId,
    provider_app_id: appId,
    playback_url: safeHttps(body.playbackUrl),
    poster_url: safeHttps(body.posterUrl),
    processing_status: "processing",
    created_by: user.id
  };
  const mediaId = body.mediaId ? String(body.mediaId) : "";
  const result = mediaId
    ? await client.from("content_media").update(values).eq("id", mediaId).eq("content_id", contentId).select("id").single()
    : await client.from("content_media").insert(values).select("id").single();
  if (result.error) return json(functionError("VIDEO_RECORD_SAVE_FAILED", "Video record could not be saved", "complete"), 400);
  return json({ id: result.data.id, fileId, appId });
}));
