import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { cosConfiguration, getCosFederationToken } from "../_shared/tencent-cos.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safePrefix = /^[a-zA-Z0-9/_-]+\/$/;
const uploadActions = [
  "name/cos:PutObject",
  "name/cos:PostObject",
  "name/cos:InitiateMultipartUpload",
  "name/cos:UploadPart",
  "name/cos:CompleteMultipartUpload",
  "name/cos:AbortMultipartUpload",
  "name/cos:ListParts",
  "name/cos:HeadObject"
];

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const purpose = String(body.purpose || "");
  const visibility = body.visibility === "public" ? "public" : "private";
  const requestedPrefix = String(body.prefix || "").replace(/^\/+/, "");
  const configuration = cosConfiguration();
  let prefix = "";

  if (purpose === "content-media") {
    const contentId = String(body.contentId || "");
    if (!uuid.test(contentId)) return json({ error: "资料编号无效" }, 400);
    const { data: content } = await client.from("contents").select("id,created_by,status").eq("id", contentId).maybeSingle();
    if (!content) return json({ error: "资料不存在" }, 404);
    if (profile.role === "uploader" && (content.created_by !== user.id || content.status !== "draft")) return json({ error: "无权上传到这篇资料" }, 403);
    prefix = visibility === "public" ? `content/${contentId}/` : `drafts/${contentId}/`;
  } else if (purpose === "document-import") {
    const importId = String(body.importId || "");
    if (!uuid.test(importId)) return json({ error: "导入任务编号无效" }, 400);
    const { data: job } = await client.from("document_imports").select("id,created_by,status").eq("id", importId).maybeSingle();
    if (!job || !["uploading", "failed"].includes(job.status)) return json({ error: "导入任务不可上传" }, 404);
    if (job.created_by !== user.id && profile.role !== "super_admin") return json({ error: "无权恢复该导入任务" }, 403);
    prefix = `imports/${importId}/`;
    if (visibility !== "private") return json({ error: "Word 图片必须先上传到私有桶" }, 400);
  } else if (purpose === "site-asset") {
    if (!["super_admin", "editor"].includes(profile.role) || visibility !== "public") return json({ error: "无权上传站点资源" }, 403);
    if (!safePrefix.test(requestedPrefix) || !["site/settings/", "site/categories/", "site/carousel/"].some((root) => requestedPrefix.startsWith(root))) return json({ error: "站点资源路径无效" }, 400);
    prefix = requestedPrefix;
  } else if (purpose === "migration") {
    if (profile.role !== "super_admin" || visibility !== "public") return json({ error: "只有超级管理员可以执行迁移" }, 403);
    if (!safePrefix.test(requestedPrefix) || !["imports/", "content/", "settings/", "categories/", "carousel/", "site/"].some((root) => requestedPrefix.startsWith(root))) return json({ error: "迁移路径无效" }, 400);
    prefix = requestedPrefix;
  } else {
    return json({ error: "不支持的 COS 上传用途" }, 400);
  }

  const bucket = visibility === "public" ? configuration.publicBucket : configuration.privateBucket;
  return json(await getCosFederationToken({ name: `maplestorynk-${user.id.slice(0, 8)}`, bucket, prefix, actions: uploadActions }));
}));
