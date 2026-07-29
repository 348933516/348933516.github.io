import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { cosConfiguration, deleteCosObject, headCosObject, signedCosObjectUrl } from "../_shared/tencent-cos.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, profile } = await requireRole(request, ["super_admin", "editor", "uploader", "viewer"]);
  const body = await request.json();
  const action = String(body.action || "signed-url");
  const contentId = String(body.contentId || "");
  const requestedPaths = action === "delete-many" && Array.isArray(body.paths) ? body.paths : [body.path];
  const keys = [...new Set(requestedPaths.map((value: unknown) => String(value || "").replace(/^\/+/, "")).filter(Boolean))];
  const key = keys[0] || "";
  const configuration = cosConfiguration();
  if (!keys.length || keys.length > 50 || keys.some((value) => value.includes(".."))) return json({ error: "Invalid COS object path batch" }, 400);

  if (contentId) {
    if (!uuid.test(contentId)) return json({ error: "Invalid content ID" }, 400);
    const { data: content } = await client.from("contents").select("id,created_by,status").eq("id", contentId).maybeSingle();
    if (!content) return json({ error: "Content not found" }, 404);
    if (profile.role === "uploader" && content.created_by !== profile.id) return json({ error: "Not allowed to access these files" }, 403);
    for (const scopedKey of keys) {
      const directPrefix = scopedKey.startsWith(`drafts/${contentId}/`) || scopedKey.startsWith(`content/${contentId}/`);
      let importOwned = false;
      const importMatch = scopedKey.match(/^imports\/([0-9a-f-]{36})\//i);
      if (importMatch && uuid.test(importMatch[1])) {
        const { data: importJob } = await client.from("document_imports").select("id").eq("id", importMatch[1]).eq("content_id", contentId).maybeSingle();
        importOwned = Boolean(importJob);
      }
      if (!directPrefix && !importOwned) return json({ error: "COS object does not belong to this content" }, 403);
    }
  } else if (profile.role !== "super_admin") {
    return json({ error: "Missing content scope" }, 400);
  }

  const requestedBucket = String(body.bucket || "");
  const bucket = requestedBucket === configuration.publicBucket ? configuration.publicBucket : configuration.privateBucket;
  if (action === "signed-url") return json({ url: await signedCosObjectUrl(bucket, key), expiresIn: 900 });
  if (action === "head") return json(await headCosObject(bucket, key));
  if (action === "delete-many") {
    if (!["super_admin", "editor"].includes(profile.role)) return json({ error: "Not allowed to delete files" }, 403);
    const results = await Promise.allSettled(keys.map((value) => deleteCosObject(bucket, value)));
    let failedIndexes = results.flatMap((result, index) => result.status === "rejected" ? [index] : []);
    if (failedIndexes.length) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const retryResults = await Promise.allSettled(failedIndexes.map((index) => deleteCosObject(bucket, keys[index])));
      failedIndexes = retryResults.flatMap((result, index) => result.status === "rejected" ? [failedIndexes[index]] : []);
    }
    if (failedIndexes.length) return json({ error: "COS batch cleanup failed", deletedCount: keys.length - failedIndexes.length, failedIndexes }, 502);
    return json({ ok: true, deletedCount: keys.length });
  }
  if (action === "delete") {
    if (!["super_admin", "editor"].includes(profile.role)) return json({ error: "Not allowed to delete files" }, 403);
    await deleteCosObject(bucket, key);
    return json({ ok: true });
  }
  return json({ error: "Unsupported COS storage action" }, 400);
}));
