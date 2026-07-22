import sanitizeHtml from "npm:sanitize-html@2.17.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { compareImportStoragePaths, expectedImportStoragePaths, importStoragePrefix } from "./storage.ts";

type ImportAsset = {
  mediaId: string;
  imageIndex: number;
  originalPath: string;
  displayPath: string;
  hash: string;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  displaySize: number;
  imageVariants?: Array<{ key: string; path: string; width: number; height: number; mimeType: string; sizeBytes: number }>;
  sortOrder: number;
  title: string;
  altText: string;
};

const publicBucket = "maplestorynk-public";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function importError(stage: string, code: string, error: string, status: number, details: Record<string, unknown> = {}) {
  return json({ error, code, stage, ...details }, status);
}

function cleanBody(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "code", "pre", "hr", "span", "mark", "div"],
    allowedAttributes: {
      a: ["href", "target", "rel", "title"], img: ["src", "srcset", "sizes", "width", "height", "loading", "decoding", "alt", "title"],
      figure: ["data-editor-image", "data-media-id", "data-original-src"], figcaption: ["data-placeholder"],
      table: ["data-table-border", "data-table-style", "data-table-color", "style"],
      th: ["colspan", "rowspan", "colwidth", "data-cell-background", "data-cell-align", "data-cell-border-width", "data-cell-border-style", "data-cell-border-color", "style"],
      td: ["colspan", "rowspan", "colwidth", "data-cell-background", "data-cell-align", "data-cell-border-width", "data-cell-border-style", "data-cell-border-color", "style"],
      span: ["class", "data-font-family", "data-font-size", "data-text-color", "data-highlight", "style"],
      mark: ["data-highlight", "style"], div: ["class"]
    },
    allowedStyles: { "*": {
      color: [/^#[0-9a-f]{6}$/i], "background-color": [/^#[0-9a-f]{6}$/i],
      "font-size": [/^(?:[8-9]|[1-6][0-9]|7[0-2])px$/], "text-align": [/^(left|center|right|justify)$/],
      "border-color": [/^#[0-9a-f]{6}$/i], "border-width": [/^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/],
      "border-style": [/^(solid|dashed|dotted|double|groove|ridge|none)$/],
      "--rich-table-color": [/^#[0-9a-f]{6}$/i], "--rich-table-border": [/^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/],
      "--rich-table-style": [/^(solid|dashed|dotted|double|groove|ridge|none)$/],
      "--rich-cell-border-color": [/^#[0-9a-f]{6}$/i], "--rich-cell-border-width": [/^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/],
      "--rich-cell-border-style": [/^(solid|dashed|dotted|double|groove|ridge|none)$/]
    } },
    allowedSchemes: ["https"], allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) }
  });
}

function assetIssues(value: unknown, importId: string) {
  if (!value || typeof value !== "object") return ["asset"];
  const asset = value as Record<string, unknown>;
  const prefix = `imports/${importId}/`;
  const issues: string[] = [];
  if (!uuid.test(String(asset.mediaId || ""))) issues.push("media_id");
  if (!Number.isInteger(Number(asset.imageIndex)) || Number(asset.imageIndex) < 1 || Number(asset.imageIndex) > 250) issues.push("image_index");
  if (!String(asset.originalPath || "").startsWith(prefix)) issues.push("original_path");
  if (!String(asset.displayPath || "").startsWith(prefix)) issues.push("display_path");
  if (!Number.isFinite(Number(asset.originalSize)) || Number(asset.originalSize) < 1) issues.push("original_size");
  if (!Number.isFinite(Number(asset.displaySize)) || Number(asset.displaySize) < 1) issues.push("display_size");
  if (asset.imageVariants !== undefined) {
    if (!Array.isArray(asset.imageVariants) || asset.imageVariants.some((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const variant = entry as Record<string, unknown>;
      return !["960", "1600"].includes(String(variant.key || ""))
        || !String(variant.path || "").startsWith(prefix)
        || !Number.isInteger(Number(variant.width)) || Number(variant.width) < 1
        || !Number.isInteger(Number(variant.height)) || Number(variant.height) < 1
        || String(variant.mimeType || "") !== "image/webp"
        || !Number.isFinite(Number(variant.sizeBytes)) || Number(variant.sizeBytes) < 1;
    })) issues.push("image_variants");
  }
  return issues;
}

async function writeEvent(client: SupabaseClient, importId: string, input: {
  phase: string; message: string; severity?: "info" | "warning" | "error"; imageIndex?: number;
  bytesTotal?: number; bytesUploaded?: number; retryCount?: number; httpStatus?: number; errorCode?: string;
  elapsedMs?: number; details?: Record<string, unknown>;
}) {
  await client.from("document_import_events").insert({
    import_id: importId, image_index: input.imageIndex || null, phase: input.phase, message: input.message.slice(0, 1000),
    severity: input.severity || "info", bytes_total: input.bytesTotal || null, bytes_uploaded: input.bytesUploaded || null,
    retry_count: input.retryCount || 0, http_status: input.httpStatus || null, error_code: input.errorCode?.slice(0, 120) || null,
    elapsed_ms: input.elapsedMs || null, details: input.details || {}
  });
}

async function removeManifestFiles(client: SupabaseClient, manifest: unknown) {
  if (!Array.isArray(manifest)) return;
  const paths = [...new Set(manifest.flatMap((asset) => {
    if (!asset || typeof asset !== "object") return [];
    const value = asset as Record<string, unknown>;
    const variants = Array.isArray(value.imageVariants) ? value.imageVariants.flatMap((entry) => entry && typeof entry === "object" ? [String((entry as Record<string, unknown>).path || "")] : []) : [];
    return [String(value.originalPath || ""), String(value.displayPath || ""), ...variants];
  }).filter(Boolean))];
  if (paths.length) await client.storage.from(publicBucket).remove(paths);
}

async function registeredAssets(client: SupabaseClient, importId: string): Promise<ImportAsset[]> {
  const { data, error } = await client.from("document_import_assets")
    .select("media_id, image_index, original_path, display_path, content_hash, original_mime_type, width, height, original_size_bytes, display_size_bytes, image_variants, sort_order, title, alt_text")
    .eq("import_id", importId)
    .order("image_index");
  if (error) throw error;
  return (data || []).map((asset) => ({
    mediaId: asset.media_id, imageIndex: asset.image_index, originalPath: asset.original_path, displayPath: asset.display_path,
    hash: asset.content_hash || "", mimeType: asset.original_mime_type || "application/octet-stream",
    width: asset.width || 0, height: asset.height || 0, originalSize: Number(asset.original_size_bytes),
    displaySize: Number(asset.display_size_bytes), imageVariants: Array.isArray(asset.image_variants) ? asset.image_variants : [], sortOrder: asset.sort_order, title: asset.title, altText: asset.alt_text
  }));
}

async function verifyImportStorage(client: SupabaseClient, importId: string, assets: ImportAsset[]) {
  const expectedPaths = expectedImportStoragePaths(assets);
  const prefix = importStoragePrefix(importId);
  const { data, error } = await client.schema("storage").from("objects")
    .select("name")
    .eq("bucket_id", publicBucket)
    .like("name", `${prefix}%`)
    .limit(1000);
  const comparison = compareImportStoragePaths(expectedPaths, (data || []).map((item) => item.name));
  return { ...comparison, error };
}

async function processStorageCleanup(client: SupabaseClient, contentId: string) {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await client.from("storage_cleanup_queue")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("content_id", contentId)
    .eq("status", "processing")
    .lt("updated_at", staleBefore);

  const { data: queued, error } = await client.from("storage_cleanup_queue")
    .select("id, storage_bucket, storage_path, retry_count")
    .eq("content_id", contentId)
    .in("status", ["pending", "failed"])
    .order("created_at")
    .limit(300);
  if (error || !queued?.length) return { removed: 0, failed: error ? 1 : 0 };

  let removed = 0;
  let failed = 0;
  const byBucket = new Map<string, typeof queued>();
  for (const row of queued) byBucket.set(row.storage_bucket, [...(byBucket.get(row.storage_bucket) || []), row]);
  for (const [bucket, rows] of byBucket) {
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      const ids = batch.map((row) => row.id);
      await client.from("storage_cleanup_queue").update({ status: "processing", updated_at: new Date().toISOString() }).in("id", ids);
      const result = await client.storage.from(bucket).remove(batch.map((row) => row.storage_path));
      if (result.error) {
        failed += batch.length;
        await client.from("storage_cleanup_queue").update({
          status: "failed", last_error: result.error.message.slice(0, 1000), updated_at: new Date().toISOString()
        }).in("id", ids);
        for (const row of batch) await client.from("storage_cleanup_queue").update({ retry_count: Number(row.retry_count || 0) + 1 }).eq("id", row.id);
      } else {
        removed += batch.length;
        await client.from("storage_cleanup_queue").update({ status: "completed", last_error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", ids);
      }
    }
  }
  return { removed, failed };
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const action = String(body.action || "");

  if (action === "start") {
    const contentId = String(body.contentId || "");
    const expectedImages = Number(body.expectedImages || 0);
    const expectedVersion = Number(body.expectedVersion || 0);
    const totalOriginalBytes = Number(body.totalOriginalBytes || 0);
    if (!uuid.test(contentId) || !Number.isInteger(expectedImages) || expectedImages < 1 || expectedImages > 250 || !Number.isInteger(expectedVersion) || expectedVersion < 1 || totalOriginalBytes < 1) return importError("start", "INVALID_IMPORT_REQUEST", "导入参数无效，请重新打开资料后再试。", 400);
    const { data: content, error } = await client.from("contents").select("id, version, created_by, status").eq("id", contentId).maybeSingle();
    if (error || !content) return importError("start", "CONTENT_NOT_FOUND", "资料不存在或已被删除。", 404);
    if (content.version !== expectedVersion) return importError("start", "VERSION_CONFLICT", "资料已被修改，请重新载入后再导入。", 409);
    if (profile.role === "uploader" && (content.created_by !== user.id || content.status !== "draft")) return importError("start", "IMPORT_FORBIDDEN", "上传管理员只能导入自己的草稿。", 403);
    const id = crypto.randomUUID();
    const { error: insertError } = await client.from("document_imports").insert({ id, content_id: contentId, created_by: user.id, expected_images: expectedImages, total_original_bytes: totalOriginalBytes, source_file_name: String(body.sourceFileName || "").slice(0, 500) || null, source_file_size: Number(body.sourceFileSize || 0) || null });
    if (insertError) return importError("start", "IMPORT_JOB_CREATE_FAILED", "无法创建导入任务。", 400, { database_error: insertError.message.slice(0, 300) });
    await writeEvent(client, id, { phase: "created", message: "已创建 Word 导入任务", bytesTotal: totalOriginalBytes, details: { expected_images: expectedImages, source_file_name: String(body.sourceFileName || "").slice(0, 500) } });
    return json({ id, uploadPrefix: `imports/${id}` });
  }

  if (action === "list") {
    let query = client.from("document_imports")
      .select("id, content_id, created_by, status, expected_images, total_original_bytes, source_file_name, source_file_size, error_message, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (profile.role !== "super_admin") query = query.eq("created_by", user.id);
    const { data, error } = await query;
    if (error) return importError("list", "IMPORT_LIST_FAILED", "无法读取文档导入日志。", 400, { database_error: error.message.slice(0, 300) });
    return json({ jobs: data || [] });
  }

  if (action === "cleanup") {
    const contentId = String(body.contentId || "");
    if (!uuid.test(contentId)) return importError("cleanup", "INVALID_CONTENT_ID", "资料编号无效。", 400);
    const { data: content, error } = await client.from("contents").select("id, created_by, status").eq("id", contentId).maybeSingle();
    if (error || !content) return importError("cleanup", "CONTENT_NOT_FOUND", "资料不存在或已被删除。", 404);
    if (profile.role === "uploader" && (content.created_by !== user.id || content.status !== "draft")) return importError("cleanup", "IMPORT_FORBIDDEN", "无权清理该资料的导入文件。", 403);
    return json(await processStorageCleanup(client, contentId));
  }

  const importId = String(body.importId || "");
  if (!uuid.test(importId)) return importError(action || "unknown", "INVALID_IMPORT_ID", "导入任务编号无效。", 400);
  const { data: job, error: jobError } = await client.from("document_imports").select("*").eq("id", importId).maybeSingle();
  if (jobError || !job) return importError(action || "unknown", "IMPORT_NOT_FOUND", "导入任务不存在或已过期。", 404, { import_id: importId });
  if (job.created_by !== user.id && profile.role !== "super_admin") return importError(action || "unknown", "IMPORT_FORBIDDEN", "无权处理此导入任务。", 403, { import_id: importId });

  if (action === "cancel" || action === "fail") {
    const manifest = Array.isArray(body.manifest) ? body.manifest : job.manifest;
    const registered = await registeredAssets(client, importId);
    await removeManifestFiles(client, manifest);
    await removeManifestFiles(client, registered);
    const { error } = await client.from("document_imports").update({ status: action === "cancel" ? "cancelled" : "failed", manifest, error_message: String(body.error || "").slice(0, 2000) }).eq("id", importId);
    if (error) return importError(action, "IMPORT_CLEANUP_FAILED", "导入清理未完成，可在运行日志中查看详情。", 400, { import_id: importId, database_error: error.message.slice(0, 300) });
    await writeEvent(client, importId, { phase: action === "cancel" ? "cancelled" : "failed", severity: action === "cancel" ? "warning" : "error", message: String(body.error || (action === "cancel" ? "管理员取消导入" : "导入失败")).slice(0, 1000), details: { removed_assets: registered.length } });
    return json({ ok: true });
  }

  if (action === "status") {
    const assets = await registeredAssets(client, importId);
    const { data: events } = await client.from("document_import_events").select("*").eq("import_id", importId).order("created_at", { ascending: false }).limit(300);
    return json({ job: { id: job.id, status: job.status, expectedImages: job.expected_images, sourceFileName: job.source_file_name, sourceFileSize: job.source_file_size, errorMessage: job.error_message }, assets, events: events || [] });
  }

  if (action === "retry") {
    const assets = await registeredAssets(client, importId);
    if (job.status === "completed" || job.status === "cancelled") return importError("retry", "IMPORT_NOT_RETRYABLE", "该导入任务已经结束，不能重新提交。", 400, { import_id: importId, import_status: job.status });
    if (assets.length !== Number(job.expected_images)) return importError("retry", "IMPORT_MANIFEST_INCOMPLETE", "已登记图片数量不完整，不能直接重试提交。", 400, { import_id: importId, expected_images: job.expected_images, uploaded_images: assets.length });
    const storage = await verifyImportStorage(client, importId, assets);
    if (storage.error) return importError("retry", "STORAGE_VERIFICATION_FAILED", "存储核验服务暂时不可用，图片和任务均已保留，请稍后重试。", 503, { import_id: importId, database_error: storage.error.message.slice(0, 500), expected_objects: storage.expectedCount });
    if (storage.missingPaths.length) return importError("retry", "STORAGE_OBJECTS_MISSING", "部分已登记图片不在存储中，不能直接重试提交。", 400, { import_id: importId, expected_objects: storage.expectedCount, found_objects: storage.foundCount, missing_count: storage.missingPaths.length, missing_paths: storage.missingPaths.slice(0, 5) });
    const { error: retryError } = await client.from("document_imports").update({ status: "uploading", error_message: null }).eq("id", importId);
    if (retryError) return importError("retry", "IMPORT_RETRY_FAILED", "无法恢复导入任务。", 400, { import_id: importId, database_error: retryError.message.slice(0, 500) });
    await writeEvent(client, importId, { phase: "status", message: `已保留并恢复 ${assets.length} 张图片，准备重新提交正文`, details: { registered_assets: assets.length } });
    return json({ ok: true, registered_assets: assets.length });
  }

  if (action === "event") {
    const event = body.event && typeof body.event === "object" ? body.event as Record<string, unknown> : {};
    const phase = String(event.phase || "failed");
    if (!['parsed','uploading','resumed','retry','uploaded','registered','failed'].includes(phase)) return importError("event", "INVALID_IMPORT_EVENT", "导入事件阶段无效。", 400, { import_id: importId });
    await writeEvent(client, importId, { phase, severity: event.severity === "warning" || event.severity === "error" ? event.severity : "info", message: String(event.message || "导入进度更新"), imageIndex: Number(event.imageIndex || 0) || undefined, bytesTotal: Number(event.bytesTotal || 0) || undefined, bytesUploaded: Number(event.bytesUploaded || 0) || undefined, retryCount: Number(event.retryCount || 0) || undefined, httpStatus: Number(event.httpStatus || 0) || undefined, errorCode: String(event.errorCode || "") || undefined, elapsedMs: Number(event.elapsedMs || 0) || undefined, details: event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {} });
    return json({ ok: true });
  }

  if (action === "manifest") {
    // Browser Worker messages are only progress signals. The registered rows
    // are the authoritative mapping used to safely assemble the final body.
    if (job.status !== "uploading") return importError("manifest", "IMPORT_NOT_UPLOADABLE", "导入任务已结束或被取消，请重新开始导入。", 400, { import_id: importId, import_status: job.status });
    const assets = await registeredAssets(client, importId);
    return json({ assets });
  }

  if (action === "register") {
    if (job.status !== "uploading") return importError("register", "IMPORT_NOT_UPLOADABLE", "导入任务已结束或被取消，请重新开始导入。", 400, { import_id: importId, import_status: job.status });
    const asset = body.asset;
    const issues = assetIssues(asset, importId);
    if (issues.length) return importError("register", "INVALID_IMPORT_ASSET", "当前图片登记信息无效，已停止导入。", 400, { import_id: importId, issues });
    const item = asset as ImportAsset;
    if (item.imageIndex > Number(job.expected_images)) return importError("register", "IMAGE_INDEX_OUT_OF_RANGE", "图片序号超出本次导入任务的范围。", 400, { import_id: importId, image_index: item.imageIndex, expected_images: job.expected_images });
    const expectedPaths = [...new Set([item.originalPath, item.displayPath, ...(item.imageVariants || []).map((variant) => variant.path)])];
    const { data: stored, error: storedError } = await client.schema("storage").from("objects").select("name").eq("bucket_id", publicBucket).in("name", expectedPaths);
    if (storedError || stored?.length !== expectedPaths.length) return importError("register", "STORAGE_OBJECTS_MISSING", "当前图片没有完整写入存储，请重新导入。", 400, { import_id: importId, image_order: item.sortOrder, found_objects: stored?.length || 0 });
    const { error: insertError } = await client.from("document_import_assets").upsert({
      import_id: importId, media_id: item.mediaId, original_path: item.originalPath, display_path: item.displayPath,
      image_index: item.imageIndex,
      content_hash: item.hash || null, original_mime_type: item.mimeType || null, width: item.width || null, height: item.height || null,
      original_size_bytes: item.originalSize, display_size_bytes: item.displaySize, image_variants: item.imageVariants || [], sort_order: item.imageIndex * 10,
      title: item.title, alt_text: item.altText
    }, { onConflict: "import_id,image_index" });
    if (insertError) return importError("register", "ASSET_REGISTRATION_FAILED", "当前图片无法登记到导入任务。", 400, { import_id: importId, image_order: item.sortOrder, database_error: insertError.message.slice(0, 300) });
    await writeEvent(client, importId, { phase: "registered", message: `图片 ${item.imageIndex} 已上传并登记`, imageIndex: item.imageIndex, bytesTotal: item.originalSize, bytesUploaded: item.originalSize, details: { mime_type: item.mimeType, storage_path: item.displayPath, sort_order: item.imageIndex * 10 } });
    const { count, error: countError } = await client.from("document_import_assets").select("media_id", { count: "exact", head: true }).eq("import_id", importId);
    if (countError) return importError("register", "ASSET_COUNT_FAILED", "图片已上传，但无法确认登记数量。", 500, { import_id: importId });
    return json({ registered_assets: count || 0 });
  }

  if (action !== "finalize") return importError("unknown", "UNSUPPORTED_IMPORT_ACTION", "不支持的导入操作。", 400);
  const assets = await registeredAssets(client, importId);
  const invalidAssets = assets.flatMap((asset, index) => {
    const issues = assetIssues(asset, importId);
    return issues.length ? [{ index: index + 1, issues }] : [];
  });
  const uniqueMediaIds = new Set(assets.map((asset) => asset && typeof asset === "object" ? String((asset as ImportAsset).mediaId || "").toLowerCase() : ""));
  if (job.status !== "uploading") return importError("finalize", "IMPORT_NOT_UPLOADABLE", "导入任务已结束或被取消，请重新开始导入。", 400, { import_id: importId, import_status: job.status });
  // Pixel dimensions and a SHA-256 are descriptive metadata. Reject only data
  // that could detach an uploaded object from this import task.
  const expectedIndexes = Array.from({ length: Number(job.expected_images) }, (_, index) => index + 1);
  const missingIndexes = expectedIndexes.filter((index) => !assets.some((asset) => asset.imageIndex === index));
  if (assets.length !== Number(job.expected_images) || assets.length > 250 || invalidAssets.length || uniqueMediaIds.size !== assets.length || missingIndexes.length) return importError("finalize", "IMPORT_MANIFEST_INCOMPLETE", "图片清单不完整，导入任务已保留，可重新选择同一份 Word 继续。", 400, { import_id: importId, expected_images: job.expected_images, uploaded_images: assets.length, missing_indexes: missingIndexes.slice(0, 20), invalid_asset_indexes: invalidAssets.map((item) => item.index).slice(0, 10), invalid_assets: invalidAssets.slice(0, 10), duplicate_media_ids: uniqueMediaIds.size !== assets.length });
  const storage = await verifyImportStorage(client, importId, assets);
  if (storage.error) return importError("finalize", "STORAGE_VERIFICATION_FAILED", "存储核验服务暂时不可用，图片和任务均已保留，请稍后重试。", 503, { import_id: importId, database_error: storage.error.message.slice(0, 500), expected_objects: storage.expectedCount });
  if (storage.missingPaths.length) return importError("finalize", "STORAGE_OBJECTS_MISSING", "部分图片确实未写入存储，任务已保留，可继续导入缺失图片。", 400, { import_id: importId, expected_objects: storage.expectedCount, found_objects: storage.foundCount, missing_count: storage.missingPaths.length, missing_paths: storage.missingPaths.slice(0, 5) });

  const cleaned = cleanBody(String(body.bodyHtml || ""));
  if (!cleaned.trim() || cleaned.length > 1_000_000) return importError("finalize", "IMPORTED_BODY_INVALID", "导入正文为空或超过允许大小。", 400, { import_id: importId });
  const figureIds = [...cleaned.matchAll(/<figure\b[^>]*\bdata-media-id=["']([0-9a-f-]{36})["']/gi)].map((match) => match[1].toLowerCase());
  const importedIds = new Set(figureIds);
  const missingFigureIds = assets.map((asset) => asset.mediaId.toLowerCase()).filter((mediaId) => !importedIds.has(mediaId));
  if (missingFigureIds.length) return importError("finalize", "BODY_IMAGE_MAPPING_MISMATCH", "正文图片映射不完整，已取消本次导入。", 400, { import_id: importId, expected_images: assets.length, body_figures: figureIds.length, missing_media_ids: missingFigureIds.slice(0, 5) });
  const text = sanitizeHtml(cleaned, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
  const { data, error } = await client.rpc("finalize_document_import", {
    p_import_id: importId, p_content_id: job.content_id, p_expected_version: Number(body.expectedVersion || 0), p_actor_id: user.id,
    p_body_html: cleaned, p_body_text: text, p_source_record: String(body.sourceRecord || "").slice(0, 20000), p_manifest: assets
  }).single();
  if (error) {
    const databaseError = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" | ").slice(0, 1500);
    await client.from("document_imports").update({ status: "failed", manifest: assets, error_message: databaseError }).eq("id", importId);
    await writeEvent(client, importId, { phase: "failed", severity: "error", message: "数据库最终提交失败，已保留全部图片，可直接重试", errorCode: String(error.code || "IMPORT_COMMIT_FAILED"), details: { database_error: databaseError } });
    return importError("finalize", error.message.includes("VERSION_CONFLICT") ? "VERSION_CONFLICT" : "IMPORT_COMMIT_FAILED", error.message.includes("VERSION_CONFLICT") ? "资料已被修改，请重新载入后再导入。" : "图片已上传并保留，但数据库提交失败；无需重新上传，可直接重试。", error.message.includes("VERSION_CONFLICT") ? 409 : 400, { import_id: importId, database_error: databaseError, registered_assets: assets.length });
  }
  const assetIds = assets.map((asset) => asset.mediaId);
  const { count: storedImages, error: countError } = await client.from("content_media").select("id", { count: "exact", head: true }).eq("content_id", job.content_id).in("id", assetIds);
  if (countError || storedImages !== assets.length) return importError("finalize", "IMPORT_VERIFICATION_FAILED", "导入提交后的图片核对失败，请勿发布并查看运行日志。", 500, { import_id: importId, expected_images: assets.length, stored_images: storedImages || 0, body_figures: figureIds.length });
  const cleanup = await processStorageCleanup(client, job.content_id);
  await writeEvent(client, importId, {
    phase: "finalized",
    message: `已提交正文和 ${storedImages} 张图片`,
    details: { body_figures: figureIds.length, stored_images: storedImages, replaced_images: data?.replaced_images || 0, cleanup_files: data?.cleanup_files || 0, cleanup_removed: cleanup.removed, cleanup_failed: cleanup.failed }
  });
  return json({ ...data, body_figures: figureIds.length, stored_images: storedImages, cleanup_removed: cleanup.removed, cleanup_failed: cleanup.failed });
}));
