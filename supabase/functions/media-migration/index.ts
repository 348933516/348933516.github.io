import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { cosConfiguration, headCosObject } from "../_shared/tencent-cos.ts";

type MigrationItem = {
  entity_type: string;
  entity_id: string;
  field_name: string;
  source_bucket: string;
  source_path: string;
  destination_bucket: string;
  destination_path: string;
  size_bytes: number;
};

function addItem(target: Map<string, MigrationItem>, item: MigrationItem) {
  const path = item.source_path?.replace(/^\/+/, "");
  if (!path || path.includes("..")) return;
  target.set(`${item.source_bucket}:${path}`, { ...item, source_path: path, destination_path: path });
}

function mediaObjectUrl(baseUrl: string, path: string) {
  return `${baseUrl}/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
}

async function verifyEdgeOneObject(baseUrl: string, path: string, expectedSize: number) {
  const response = await fetch(mediaObjectUrl(baseUrl, path), { method: "HEAD", headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`EdgeOne 在线核验失败（HTTP ${response.status}）`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (expectedSize > 0 && contentLength > 0 && contentLength !== expectedSize) {
    throw new Error(`EdgeOne 文件大小不一致：预期 ${expectedSize}，实际 ${contentLength}`);
  }
  return { contentLength, cacheStatus: response.headers.get("eo-cache-status") || response.headers.get("x-cache") || "" };
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user } = await requireRole(request, ["super_admin"]);
  const body = await request.json();
  const action = String(body.action || "status");
  const configuration = cosConfiguration();

  if (action === "start") {
    const { data: active } = await client.from("media_storage_migrations").select("id,status").in("status", ["pending", "copying", "verifying", "committing", "failed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (active) return json({ id: active.id, status: active.status, resumed: true });
    const { data: job, error: jobError } = await client.from("media_storage_migrations").insert({ created_by: user.id, status: "pending" }).select("*").single();
    if (jobError || !job) return json({ error: jobError?.message || "无法创建迁移任务" }, 400);
    const items = new Map<string, MigrationItem>();
    const [mediaResult, attachmentResult, settingsResult, categoryResult, carouselResult] = await Promise.all([
      client.from("content_media").select("id,storage_bucket,storage_path,original_storage_path,display_storage_path,image_variants,size_bytes,original_size_bytes").eq("storage_provider", "supabase").eq("storage_bucket", "maplestorynk-public"),
      client.from("attachments").select("id,storage_bucket,storage_path,size_bytes").eq("storage_provider", "supabase").eq("storage_bucket", "maplestorynk-public"),
      client.from("site_settings").select("id,top_logo_path,top_logo_provider,hero_logo_path,hero_logo_provider,page_background_path,page_background_provider,tile_background_path,tile_background_provider").eq("id", "main").maybeSingle(),
      client.from("categories").select("id,image_path").eq("image_provider", "supabase"),
      client.from("carousel_slides").select("id,image_path").eq("image_provider", "supabase")
    ]);
    const failed = [mediaResult.error, attachmentResult.error, settingsResult.error, categoryResult.error, carouselResult.error].find(Boolean);
    if (failed) return json({ error: failed.message }, 400);
    for (const row of mediaResult.data || []) {
      const base = { entity_type: "content_media", entity_id: row.id, source_bucket: row.storage_bucket, destination_bucket: configuration.publicBucket };
      addItem(items, { ...base, field_name: "storage_path", source_path: row.storage_path, destination_path: row.storage_path, size_bytes: Number(row.size_bytes || 0) });
      if (row.original_storage_path) addItem(items, { ...base, field_name: "original_storage_path", source_path: row.original_storage_path, destination_path: row.original_storage_path, size_bytes: Number(row.original_size_bytes || 0) });
      if (row.display_storage_path) addItem(items, { ...base, field_name: "display_storage_path", source_path: row.display_storage_path, destination_path: row.display_storage_path, size_bytes: Number(row.size_bytes || 0) });
      for (const variant of Array.isArray(row.image_variants) ? row.image_variants : []) {
        if (variant?.path) addItem(items, { ...base, field_name: `variant:${variant.key || variant.width || "preview"}`, source_path: variant.path, destination_path: variant.path, size_bytes: Number(variant.sizeBytes || variant.size_bytes || 0) });
      }
    }
    for (const row of attachmentResult.data || []) addItem(items, { entity_type: "attachments", entity_id: row.id, field_name: "storage_path", source_bucket: row.storage_bucket, source_path: row.storage_path, destination_bucket: configuration.publicBucket, destination_path: row.storage_path, size_bytes: Number(row.size_bytes || 0) });
    const settingFields = ["top_logo_path", "hero_logo_path", "page_background_path", "tile_background_path"];
    const settings = (settingsResult.data || {}) as Record<string, unknown>;
    for (const field of settingFields) if (settings[field] && settings[field.replace(/_path$/, "_provider")] !== "tencent_cos") addItem(items, { entity_type: "site_settings", entity_id: "main", field_name: field, source_bucket: "maplestorynk-public", source_path: String(settings[field]), destination_bucket: configuration.publicBucket, destination_path: String(settings[field]), size_bytes: 0 });
    for (const row of categoryResult.data || []) if (row.image_path) addItem(items, { entity_type: "categories", entity_id: row.id, field_name: "image_path", source_bucket: "maplestorynk-public", source_path: row.image_path, destination_bucket: configuration.publicBucket, destination_path: row.image_path, size_bytes: 0 });
    for (const row of carouselResult.data || []) if (row.image_path) addItem(items, { entity_type: "carousel_slides", entity_id: row.id, field_name: "image_path", source_bucket: "maplestorynk-public", source_path: row.image_path, destination_bucket: configuration.publicBucket, destination_path: row.image_path, size_bytes: 0 });
    const records = [...items.values()].map((item) => ({ migration_id: job.id, ...item }));
    for (let offset = 0; offset < records.length; offset += 100) {
      const { error } = await client.from("media_storage_migration_items").insert(records.slice(offset, offset + 100));
      if (error) {
        await client.from("media_storage_migrations").delete().eq("id", job.id);
        return json({ error: `迁移清单创建失败：${error.message}` }, 400);
      }
    }
    const totalBytes = records.reduce((sum, item) => sum + item.size_bytes, 0);
    await client.from("media_storage_migrations").update({ status: "copying", total_objects: records.length, total_bytes: totalBytes, updated_at: new Date().toISOString() }).eq("id", job.id);
    return json({ id: job.id, status: "copying", totalObjects: records.length, totalBytes });
  }

  const migrationId = String(body.migrationId || "");
  const { data: job } = await client.from("media_storage_migrations").select("*").eq("id", migrationId).maybeSingle();
  if (!job) return json({ error: "迁移任务不存在" }, 404);
  if (action === "status") {
    const { data: items, error } = await client.from("media_storage_migration_items").select("*").eq("migration_id", migrationId).order("id").limit(1000);
    if (error) return json({ error: error.message }, 400);
    return json({ job, items: items || [] });
  }
  if (action === "cancel") {
    if (job.status === "completed" || job.status === "committing") {
      return json({ error: "迁移已经进入数据库切换阶段，不能取消" }, 409);
    }
    if (job.status === "cancelled") return json({ ok: true, status: "cancelled", alreadyCancelled: true });
    const { data: cancelled, error } = await client.from("media_storage_migrations")
      .update({
        status: "cancelled",
        error_message: "管理员取消迁移；Supabase 源文件和数据库媒体来源均未修改。",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", migrationId)
      .in("status", ["pending", "copying", "verifying", "failed"])
      .select("id,status")
      .maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!cancelled) return json({ error: "迁移状态已变化，请刷新后重试" }, 409);
    return json({ ok: true, status: cancelled.status, alreadyCancelled: false });
  }
  if (action === "register") {
    const itemId = Number(body.itemId || 0);
    const { data: item } = await client.from("media_storage_migration_items").select("*").eq("id", itemId).eq("migration_id", migrationId).maybeSingle();
    if (!item) return json({ error: "迁移对象不存在" }, 404);
    const stored = await headCosObject(configuration.publicBucket, item.destination_path);
    if (Number(item.size_bytes || 0) > 0 && stored.sizeBytes !== Number(item.size_bytes)) return json({ error: `COS 文件大小不一致：预期 ${item.size_bytes}，实际 ${stored.sizeBytes}` }, 400);
    const edge = await verifyEdgeOneObject(configuration.mediaBaseUrl, item.destination_path, stored.sizeBytes);
    await client.from("media_storage_migration_items").update({ status: "verified", etag: stored.etag, size_bytes: stored.sizeBytes, error_message: null, updated_at: new Date().toISOString() }).eq("id", item.id);
    const { count } = await client.from("media_storage_migration_items").select("id", { count: "exact", head: true }).eq("migration_id", migrationId).eq("status", "verified");
    const { data: sums } = await client.from("media_storage_migration_items").select("size_bytes").eq("migration_id", migrationId).eq("status", "verified");
    await client.from("media_storage_migrations").update({ status: "verifying", completed_objects: count || 0, completed_bytes: (sums || []).reduce((sum, row) => sum + Number(row.size_bytes || 0), 0), updated_at: new Date().toISOString() }).eq("id", migrationId);
    return json({ ok: true, etag: stored.etag, sizeBytes: stored.sizeBytes, edgeCacheStatus: edge.cacheStatus });
  }
  if (action === "commit") {
    const { count: pending } = await client.from("media_storage_migration_items").select("id", { count: "exact", head: true }).eq("migration_id", migrationId).in("status", ["pending", "uploading", "failed"]);
    if (pending) return json({ error: `仍有 ${pending} 个对象未核验` }, 400);
    const supabaseBase = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/maplestorynk-public/`;
    const { error: commitError } = await client.rpc("commit_cos_media_migration", { p_migration_id: migrationId, p_actor_id: user.id, p_cos_bucket: configuration.publicBucket, p_supabase_base_url: supabaseBase, p_media_base_url: `${configuration.mediaBaseUrl}/` });
    if (commitError) return json({ error: commitError.message }, 400);
    const { data: items } = await client.from("media_storage_migration_items").select("id,source_bucket,source_path").eq("migration_id", migrationId).eq("status", "verified");
    const warnings: string[] = [];
    for (let offset = 0; offset < (items || []).length; offset += 100) {
      const batch = (items || []).slice(offset, offset + 100);
      const { error } = await client.storage.from("maplestorynk-public").remove(batch.map((item) => item.source_path));
      if (error) warnings.push(error.message);
      else await client.from("media_storage_migration_items").update({ status: "committed", updated_at: new Date().toISOString() }).in("id", batch.map((item) => item.id));
    }
    await client.from("media_storage_migrations").update({ status: warnings.length ? "failed" : "completed", error_message: warnings.join(" | ").slice(0, 2000) || null, completed_at: warnings.length ? null : new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", migrationId);
    return json({ ok: warnings.length === 0, warnings });
  }
  return json({ error: "不支持的迁移操作" }, 400);
}));
