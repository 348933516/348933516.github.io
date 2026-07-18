import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "https://edznwgvyqpsibnkqqeby.supabase.co";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_kuMMovS2ZpF7w9lkiK86Ww_VKkgdgao";
const email = process.env.SUPABASE_ADMIN_EMAIL;
const password = process.env.SUPABASE_ADMIN_PASSWORD;
if (!email || !password) throw new Error("Set SUPABASE_ADMIN_EMAIL and SUPABASE_ADMIN_PASSWORD before migration");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password });
if (authError || !auth.user) throw new Error(authError?.message || "Admin login failed");
const { data: profile } = await client.from("profiles").select("role, status").eq("id", auth.user.id).maybeSingle();
if (profile?.role !== "super_admin" || profile.status !== "active") throw new Error("The migration account is not an active super administrator");

const input = process.argv[2];
let legacyRow;
if (input) {
  legacyRow = JSON.parse(await fs.readFile(path.resolve(input), "utf8"));
} else {
  const { data, error } = await client.from("site_state").select("*").eq("id", "main").single();
  if (error) throw error;
  legacyRow = data;
}
const state = legacyRow.data || legacyRow;
const backupDirectory = path.resolve("local-backups");
await fs.mkdir(backupDirectory, { recursive: true });
const backupPath = path.join(backupDirectory, `site-state-before-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await fs.writeFile(backupPath, JSON.stringify(legacyRow, null, 2), "utf8");
console.log(`Pre-migration backup: ${backupPath}`);
const slugify = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || `item-${crypto.randomUUID()}`;
const stripHtml = (value) => String(value || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function decodeDataUrl(value) {
  const match = String(value).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}

async function uploadAsset(value, destination, bucket = "maplestorynk-public") {
  if (!value) return null;
  let bytes;
  let mime = "application/octet-stream";
  const data = decodeDataUrl(value);
  if (data) {
    bytes = data.bytes;
    mime = data.mime;
  } else if (/^https:\/\//i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) return null;
    bytes = Buffer.from(await response.arrayBuffer());
    mime = response.headers.get("content-type")?.split(";")[0] || mime;
  } else return null;
  const extension = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.includes("mp4") ? "mp4" : "jpg";
  const storagePath = `${destination}.${extension}`;
  const { error } = await client.storage.from(bucket).upload(storagePath, bytes, { contentType: mime, upsert: true });
  if (error) throw error;
  return storagePath;
}

const appearance = state.appearance || {};
const settingAssets = {};
for (const [field, value] of Object.entries({ top_logo_path: appearance.topLogo, hero_logo_path: appearance.heroLogo, page_background_path: appearance.pageBg, hero_background_path: appearance.heroBg, tile_background_path: appearance.tileBg })) {
  try { settingAssets[field] = await uploadAsset(value, `legacy/settings/${field}`); }
  catch (error) { console.warn(`Skipped ${field}: ${error.message}`); }
}
const { error: settingsError } = await client.from("site_settings").upsert({
  id: "main",
  migration_completed: false,
  brand_title: appearance.brandTitle || "MapleStoryNK",
  brand_subtitle: appearance.brandSubtitle || "业务与地图资料中心",
  hero_title: appearance.heroTitle || "MapleStoryNK",
  hero_subtitle: appearance.heroSubtitle || "",
  category_title: appearance.categoryTitle || "类目展示",
  category_subtitle: appearance.categorySubtitle || "",
  ...settingAssets,
  updated_by: auth.user.id
});
if (settingsError) throw settingsError;

const categoryIds = new Map();
for (const [index, name] of (state.categories || []).entries()) {
  let imagePath = null;
  try { imagePath = await uploadAsset(state.categoryImages?.[name], `legacy/categories/${slugify(name)}`); }
  catch (error) { console.warn(`Skipped category image ${name}: ${error.message}`); }
  const { data, error } = await client.from("categories").upsert({
    name,
    slug: slugify(name),
    description: state.categoryTexts?.[name] || "资料分类",
    image_path: imagePath,
    sort_order: (index + 1) * 10,
    is_visible: true,
    created_by: auth.user.id,
    updated_by: auth.user.id
  }, { onConflict: "name" }).select("id").single();
  if (error) throw error;
  categoryIds.set(name, data.id);
}

let mediaCount = 0;
const migratedContentIds = [];
for (const [index, item] of (state.contents || []).entries()) {
  const categoryId = categoryIds.get(item.category) || categoryIds.values().next().value;
  const status = ["published", "draft", "hidden"].includes(item.status) ? item.status : "draft";
  const writeStatus = status === "published" ? "draft" : status;
  const legacyId = String(item.id || `legacy-${index}`);
  const { data: existingContent, error: existingError } = await client.from("contents").select("id, version").eq("legacy_id", legacyId).maybeSingle();
  if (existingError) throw existingError;
  const { data: content, error } = await client.functions.invoke("save-content", { body: {
    id: existingContent?.id,
    version: existingContent?.version || 1,
    legacyId,
    categoryId,
    slug: slugify(legacyId),
    title: item.title || "未命名资料",
    summary: item.summary || "",
    bodyJson: {},
    bodyHtml: item.bodyHtml || "",
    bodyText: stripHtml(item.bodyHtml),
    sourceRecord: item.source || "",
    status: writeStatus,
    sortOrder: Number(item.order || 100),
    featured: false
  } });
  if (error || content?.error || !content?.id) throw new Error(error?.message || content?.error || "Content migration failed");
  migratedContentIds.push(content.id);
  await client.from("content_media").delete().eq("content_id", content.id);
  const rawMedia = item.mediaItems?.length ? item.mediaItems : (item.images?.length ? item.images : [item.image]).filter(Boolean).map((src) => ({ src }));
  for (const [mediaIndex, media] of rawMedia.entries()) {
    const source = media.src || media.url || media.image;
    const row = {
      content_id: content.id,
      kind: media.type === "video" ? "video" : "image",
      title: media.title || `图片 ${mediaIndex + 1}`,
      note: media.note || "",
      hierarchy_path: String(media.path || item.category || "").split("/").filter(Boolean),
      alt_text: media.title || item.title || "图片",
      sort_order: (mediaIndex + 1) * 10,
      created_by: auth.user.id
    };
    const dataUrl = decodeDataUrl(source);
    if (dataUrl) {
      const bucket = "maplestorynk-private";
      const storagePath = await uploadAsset(source, `legacy/content/${content.id}/${mediaIndex + 1}`, bucket);
      Object.assign(row, { storage_bucket: bucket, storage_path: storagePath });
    } else if (/^https:\/\//i.test(source || "")) Object.assign(row, { external_url: source });
    else continue;
    const { error: mediaError } = await client.from("content_media").insert(row);
    if (mediaError) throw mediaError;
    mediaCount += 1;
  }
  if (status === "published") {
    const { data: published, error: publishError } = await client.functions.invoke("publish-content", {
      body: { contentId: content.id, version: content.version }
    });
    if (publishError || published?.error) throw new Error(publishError?.message || published.error);
  }
}

const { count: migratedContentCount, error: countError } = await client.from("contents").select("id", { count: "exact", head: true }).in("id", migratedContentIds);
if (countError) throw countError;
if (migratedContentCount !== (state.contents || []).length) throw new Error(`Content count mismatch: expected ${(state.contents || []).length}, got ${migratedContentCount}`);
const { count: migratedMediaCount, error: mediaCountError } = migratedContentIds.length
  ? await client.from("content_media").select("id", { count: "exact", head: true }).in("content_id", migratedContentIds)
  : { count: 0, error: null };
if (mediaCountError) throw mediaCountError;
if (migratedMediaCount !== mediaCount) throw new Error(`Media count mismatch: expected ${mediaCount}, got ${migratedMediaCount}`);
const { error: completionError } = await client.from("site_settings").update({ migration_completed: true, updated_by: auth.user.id }).eq("id", "main");
if (completionError) throw completionError;
console.log(`Migration complete: ${categoryIds.size} categories, ${(state.contents || []).length} contents, ${mediaCount} media items.`);
await client.auth.signOut();
