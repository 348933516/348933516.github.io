import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { callTencentVod, vodConfiguration } from "../_shared/tencent-vod.ts";

function httpsUrl(value: unknown) {
  const normalized = String(value || "").replace(/^http:/i, "https:");
  return /^https:\/\//i.test(normalized) ? normalized : null;
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client } = await requireRole(request, ["super_admin", "editor", "uploader", "viewer"]);
  const body = await request.json();
  const mediaId = String(body.mediaId || "");
  const { data: media } = await client.from("content_media").select("*").eq("id", mediaId).maybeSingle();
  if (!media || media.video_provider !== "tencent_vod") return json({ error: "云点播视频不存在" }, 404);
  let fileId = String(media.provider_file_id || "");
  if (!fileId && media.provider_task_id) {
    const task = await callTencentVod("DescribeTaskDetail", { TaskId: media.provider_task_id });
    const pullTask = task.PullUploadTask as Record<string, unknown> | undefined;
    if (pullTask?.Status === "FAIL") {
      await client.from("content_media").update({ processing_status: "failed" }).eq("id", mediaId);
      return json({ status: "failed", error: String(pullTask.ErrCodeExt || "云端导入失败") });
    }
    const output = pullTask?.Output as Record<string, unknown> | undefined;
    fileId = String(output?.FileId || "");
    if (!fileId) return json({ status: "processing" });
  }
  const description = await callTencentVod("DescribeMediaInfos", { FileIds: [fileId], Filters: ["basicInfo", "transcodeInfo", "adaptiveDynamicStreamingInfo"] });
  const mediaInfo = Array.isArray(description.MediaInfoSet) ? description.MediaInfoSet[0] as Record<string, unknown> : null;
  if (!mediaInfo) return json({ status: "processing" });
  const basic = mediaInfo.BasicInfo as Record<string, unknown> | undefined;
  const adaptive = mediaInfo.AdaptiveDynamicStreamingInfo as { AdaptiveDynamicStreamingSet?: Array<Record<string, unknown>> } | undefined;
  const transcode = mediaInfo.TranscodeInfo as { TranscodeSet?: Array<Record<string, unknown>> } | undefined;
  const adaptiveUrl = adaptive?.AdaptiveDynamicStreamingSet?.map((entry) => httpsUrl(entry.Url)).find(Boolean);
  const hlsUrl = transcode?.TranscodeSet?.map((entry) => httpsUrl(entry.Url)).find((url) => url?.includes(".m3u8"));
  const playbackUrl = adaptiveUrl || hlsUrl || null;
  const configuration = vodConfiguration();
  await client.from("content_media").update({
    provider_file_id: fileId,
    provider_app_id: configuration.appId,
    playback_url: playbackUrl,
    poster_url: httpsUrl(basic?.CoverUrl),
    processing_status: playbackUrl ? "ready" : "processing"
  }).eq("id", mediaId);
  return json({ status: playbackUrl ? "ready" : "processing", fileId, appId: configuration.appId, playbackUrl });
}));
