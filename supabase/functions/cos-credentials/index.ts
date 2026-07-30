import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { cosConfiguration, getCosFederationToken } from "../_shared/tencent-cos.ts";
import { functionError } from "../_shared/function-errors.ts";

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
const bucketActions = ["name/cos:ListMultipartUploads"];

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const purpose = String(body.purpose || "");
  const visibility = body.visibility === "public" ? "public" : "private";
  const requestedPrefix = String(body.prefix || "").replace(/^\/+/, "");
  let configuration: ReturnType<typeof cosConfiguration>;
  try {
    configuration = cosConfiguration();
  } catch {
    return json(functionError("COS_CONFIG_MISSING", "COS configuration is incomplete", "credentials"), 503);
  }
  let prefix = "";

  if (purpose === "content-media") {
    const contentId = String(body.contentId || "");
    if (!uuid.test(contentId)) return json(functionError("CONTENT_ID_INVALID", "Content id is invalid", "credentials"), 400);
    const { data: content } = await client.from("contents").select("id,created_by,status").eq("id", contentId).maybeSingle();
    if (!content) return json(functionError("CONTENT_NOT_FOUND", "Content does not exist", "credentials"), 404);
    if (profile.role === "uploader" && (content.created_by !== user.id || content.status !== "draft")) return json(functionError("ROLE_FORBIDDEN", "Content upload is not allowed", "credentials"), 403);
    prefix = visibility === "public" ? `content/${contentId}/` : `drafts/${contentId}/`;
  } else if (purpose === "document-import") {
    const importId = String(body.importId || "");
    if (!uuid.test(importId)) return json(functionError("IMPORT_ID_INVALID", "Import id is invalid", "credentials"), 400);
    const { data: job } = await client.from("document_imports").select("id,created_by,status").eq("id", importId).maybeSingle();
    if (!job || !["uploading", "failed"].includes(job.status)) return json(functionError("IMPORT_NOT_UPLOADABLE", "Import is not uploadable", "credentials"), 404);
    if (job.created_by !== user.id && profile.role !== "super_admin") return json(functionError("ROLE_FORBIDDEN", "Import recovery is not allowed", "credentials"), 403);
    prefix = `imports/${importId}/`;
    if (visibility !== "private") return json(functionError("IMPORT_VISIBILITY_INVALID", "Word images must use private storage before publish", "credentials"), 400);
  } else if (purpose === "site-asset") {
    if (!["super_admin", "editor"].includes(profile.role) || visibility !== "public") return json(functionError("ROLE_FORBIDDEN", "Site asset upload is not allowed", "credentials"), 403);
    if (!safePrefix.test(requestedPrefix) || !["site/settings/", "site/categories/", "site/carousel/"].some((root) => requestedPrefix.startsWith(root))) return json(functionError("COS_PREFIX_INVALID", "Site asset path is invalid", "credentials"), 400);
    prefix = requestedPrefix;
  } else if (purpose === "migration") {
    if (profile.role !== "super_admin" || visibility !== "public") return json(functionError("ROLE_FORBIDDEN", "Migration is not allowed", "credentials"), 403);
    if (!safePrefix.test(requestedPrefix) || !["imports/", "content/", "settings/", "categories/", "carousel/", "site/"].some((root) => requestedPrefix.startsWith(root))) return json(functionError("COS_PREFIX_INVALID", "Migration path is invalid", "credentials"), 400);
    prefix = requestedPrefix;
  } else {
    return json(functionError("COS_PURPOSE_INVALID", "COS upload purpose is invalid", "credentials"), 400);
  }

  const bucket = visibility === "public" ? configuration.publicBucket : configuration.privateBucket;
  const actions = visibility === "private"
    ? [...uploadActions, "name/cos:GetObject", "name/cos:DeleteObject"]
    : uploadActions;
  try {
    return json(await getCosFederationToken({
      name: `maplestorynk-${user.id.slice(0, 8)}`,
      bucket,
      prefix,
      objectActions: actions,
      bucketActions
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const forbidden = /forbidden|unauthorized|authfailure|permission/i.test(detail);
    return json(functionError(
      forbidden ? "COS_STS_FORBIDDEN" : "COS_STS_FAILED",
      forbidden ? "COS STS permission was denied" : "COS temporary credentials could not be issued",
      "credentials"
    ), forbidden ? 403 : 502);
  }
}));
