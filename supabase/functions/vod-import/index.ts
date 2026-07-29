import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { callTencentVod, vodConfiguration } from "../_shared/tencent-vod.ts";
import { cosConfiguration, signedCosObjectUrl } from "../_shared/tencent-cos.ts";

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const mediaId = String(body.mediaId || "");
  if (!mediaId) return json({ error: "视频编号无效" }, 400);
  const { data: media } = await client.from("content_media").select("id, content_id, title, storage_provider, storage_bucket, storage_path, external_url, contents(status, created_by)").eq("id", mediaId).maybeSingle();
  if (!media) return json({ error: "视频不存在" }, 404);
  const content = Array.isArray(media.contents) ? media.contents[0] : media.contents;
  if (profile.role === "uploader" && (content?.status !== "draft" || content?.created_by !== user.id)) return json({ error: "无权修改这个视频" }, 403);
  let sourceUrl = String(media.external_url || "");
  if (media.storage_path && media.storage_provider === "tencent_cos") {
    const cos = cosConfiguration();
    sourceUrl = media.storage_bucket === cos.publicBucket
      ? `${cos.mediaBaseUrl}/${media.storage_path.split("/").map(encodeURIComponent).join("/")}`
      : await signedCosObjectUrl(cos.privateBucket, media.storage_path);
  } else if (media.storage_path && media.storage_bucket) {
    if (media.storage_bucket === "maplestorynk-public") sourceUrl = client.storage.from(media.storage_bucket).getPublicUrl(media.storage_path).data.publicUrl;
    else sourceUrl = (await client.storage.from(media.storage_bucket).createSignedUrl(media.storage_path, 3600)).data?.signedUrl || "";
  }
  if (!/^https:\/\//i.test(sourceUrl)) return json({ error: "视频存储地址无效" }, 400);
  const configuration = vodConfiguration();
  const response = await callTencentVod("PullUpload", { MediaUrl: sourceUrl, MediaName: media.title || "MapleStoryNK 视频", Procedure: configuration.procedure });
  const taskId = String(response.TaskId || "");
  if (!taskId) return json({ error: "腾讯云没有返回导入任务" }, 502);
  const { error } = await client.from("content_media").update({ video_provider: "tencent_vod", provider_app_id: configuration.appId, provider_task_id: taskId, processing_status: "processing" }).eq("id", mediaId);
  if (error) return json({ error: error.message }, 400);
  return json({ mediaId, taskId, status: "processing" });
}));
