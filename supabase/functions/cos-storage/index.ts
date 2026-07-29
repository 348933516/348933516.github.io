import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { cosConfiguration, deleteCosObject, headCosObject, signedCosObjectUrl } from "../_shared/tencent-cos.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, profile } = await requireRole(request, ["super_admin", "editor", "uploader", "viewer"]);
  const body = await request.json();
  const action = String(body.action || "signed-url");
  const contentId = String(body.contentId || "");
  const key = String(body.path || "").replace(/^\/+/, "");
  const configuration = cosConfiguration();
  if (!key || key.includes("..")) return json({ error: "COS 对象路径无效" }, 400);

  if (contentId) {
    if (!uuid.test(contentId)) return json({ error: "资料编号无效" }, 400);
    const { data: content } = await client.from("contents").select("id,created_by,status").eq("id", contentId).maybeSingle();
    if (!content) return json({ error: "资料不存在" }, 404);
    if (profile.role === "uploader" && content.created_by !== profile.id) return json({ error: "无权访问该资料文件" }, 403);
    const directPrefix = key.startsWith(`drafts/${contentId}/`) || key.startsWith(`content/${contentId}/`);
    let importOwned = false;
    const importMatch = key.match(/^imports\/([0-9a-f-]{36})\//i);
    if (importMatch && uuid.test(importMatch[1])) {
      const { data: importJob } = await client.from("document_imports").select("id").eq("id", importMatch[1]).eq("content_id", contentId).maybeSingle();
      importOwned = Boolean(importJob);
    }
    if (!directPrefix && !importOwned) return json({ error: "COS 对象不属于当前资料" }, 403);
  } else if (profile.role !== "super_admin") {
    return json({ error: "缺少资料范围" }, 400);
  }

  const requestedBucket = String(body.bucket || "");
  const bucket = requestedBucket === configuration.publicBucket ? configuration.publicBucket : configuration.privateBucket;
  if (action === "signed-url") return json({ url: await signedCosObjectUrl(bucket, key), expiresIn: 900 });
  if (action === "head") return json(await headCosObject(bucket, key));
  if (action === "delete") {
    if (!["super_admin", "editor"].includes(profile.role)) return json({ error: "无权删除文件" }, 403);
    await deleteCosObject(bucket, key);
    return json({ ok: true });
  }
  return json({ error: "不支持的 COS 存储操作" }, 400);
}));
