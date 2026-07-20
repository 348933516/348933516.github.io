import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { callTencentVod, vodConfiguration } from "../_shared/tencent-vod.ts";

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const mediaId = String(body.mediaId || "");
  const sourceUrl = String(body.sourceUrl || "");
  if (!mediaId || !/^https:\/\/[^/]+\.supabase\.co\//i.test(sourceUrl)) return json({ error: "旧视频地址无效" }, 400);
  const { data: media } = await client.from("content_media").select("id, content_id, title, contents(status, created_by)").eq("id", mediaId).maybeSingle();
  if (!media) return json({ error: "视频不存在" }, 404);
  const content = Array.isArray(media.contents) ? media.contents[0] : media.contents;
  if (profile.role === "uploader" && (content?.status !== "draft" || content?.created_by !== user.id)) return json({ error: "无权修改这个视频" }, 403);
  const configuration = vodConfiguration();
  const response = await callTencentVod("PullUpload", { MediaUrl: sourceUrl, MediaName: media.title || "MapleStoryNK 视频", Procedure: configuration.procedure });
  const taskId = String(response.TaskId || "");
  if (!taskId) return json({ error: "腾讯云没有返回导入任务" }, 502);
  const { error } = await client.from("content_media").update({ video_provider: "tencent_vod", provider_app_id: configuration.appId, provider_task_id: taskId, processing_status: "processing" }).eq("id", mediaId);
  if (error) return json({ error: error.message }, 400);
  return json({ mediaId, taskId, status: "processing" });
}));
