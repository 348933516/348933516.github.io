import sanitizeHtml from "npm:sanitize-html@2.17.0";
import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

type LegacyState = Record<string, unknown>;

function slugify(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();
}

function cleanBody(value: unknown) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "code", "pre", "hr", "span"],
    allowedAttributes: { a: ["href", "target", "rel", "title"], img: ["src", "alt", "title"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"], span: ["class"] },
    allowedSchemes: ["https"],
    allowProtocolRelative: false
  });
}

function decodeDataUrl(value: unknown) {
  const match = String(value || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const decoded = atob(match[2]);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("A legacy asset exceeds 100MB");
  return { mime: match[1], bytes };
}

function extensionFor(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  return "jpg";
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user } = await requireRole(request, ["super_admin"]);
  const { data: currentSettings } = await client.from("site_settings").select("migration_completed").eq("id", "main").single();
  if (currentSettings?.migration_completed) return json({ message: "Migration already completed" });

  const { data: legacyRow, error: legacyError } = await client.from("site_state").select("data").eq("id", "main").single();
  if (legacyError || !legacyRow?.data) return json({ error: legacyError?.message ?? "Legacy site state was not found" }, 404);
  const state = legacyRow.data as LegacyState;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `migration-backups/site-state-${timestamp}.json`;
  const backup = new TextEncoder().encode(JSON.stringify({ id: "main", data: state }, null, 2));
  const { error: backupError } = await client.storage.from("maplestorynk-private").upload(backupPath, backup, { contentType: "application/json", upsert: false });
  if (backupError) return json({ error: `Backup failed: ${backupError.message}` }, 400);

  await client.from("site_settings").update({ migration_completed: false, updated_by: user.id }).eq("id", "main");

  const uploadAsset = async (value: unknown, destination: string, bucket = "maplestorynk-public") => {
    if (!value) return null;
    let bytes: Uint8Array;
    let mime = "application/octet-stream";
    const data = decodeDataUrl(value);
    if (data) {
      bytes = data.bytes;
      mime = data.mime;
    } else {
      const source = String(value);
      if (!source.startsWith("https://")) return null;
      const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 100 * 1024 * 1024) throw new Error("A legacy asset exceeds 100MB");
      bytes = new Uint8Array(buffer);
      mime = response.headers.get("content-type")?.split(";")[0] || mime;
    }
    const storagePath = `${destination}.${extensionFor(mime)}`;
    const { error } = await client.storage.from(bucket).upload(storagePath, bytes, { contentType: mime, upsert: true });
    if (error) throw error;
    return storagePath;
  };

  const appearance = (state.appearance || {}) as Record<string, unknown>;
  const settingAssets: Record<string, string | null> = {};
  for (const [field, value] of Object.entries({ top_logo_path: appearance.topLogo, hero_logo_path: appearance.heroLogo, page_background_path: appearance.pageBg, hero_background_path: appearance.heroBg, tile_background_path: appearance.tileBg })) {
    settingAssets[field] = await uploadAsset(value, `legacy/settings/${field}`);
  }
  const { error: settingsError } = await client.from("site_settings").update({
    brand_title: appearance.brandTitle || "MapleStoryNK",
    brand_subtitle: appearance.brandSubtitle || "业务与地图资料中心",
    hero_title: appearance.heroTitle || "MapleStoryNK",
    hero_subtitle: appearance.heroSubtitle || "",
    category_title: appearance.categoryTitle || "类目展示",
    category_subtitle: appearance.categorySubtitle || "",
    ...settingAssets,
    updated_by: user.id
  }).eq("id", "main");
  if (settingsError) return json({ error: settingsError.message }, 400);

  const categoryNames = Array.isArray(state.categories) ? state.categories.map(String) : [];
  const categoryImages = (state.categoryImages || {}) as Record<string, unknown>;
  const categoryTexts = (state.categoryTexts || {}) as Record<string, unknown>;
  const categoryIds = new Map<string, string>();
  for (const [index, name] of categoryNames.entries()) {
    const imagePath = await uploadAsset(categoryImages[name], `legacy/categories/${slugify(name)}`);
    const { data, error } = await client.from("categories").upsert({
      name,
      slug: slugify(name),
      description: String(categoryTexts[name] || "资料分类"),
      image_path: imagePath,
      sort_order: (index + 1) * 10,
      is_visible: true,
      created_by: user.id,
      updated_by: user.id
    }, { onConflict: "name" }).select("id").single();
    if (error || !data) return json({ error: error?.message ?? `Unable to migrate category ${name}` }, 400);
    categoryIds.set(name, data.id);
  }

  const legacyContents = Array.isArray(state.contents) ? state.contents as Array<Record<string, unknown>> : [];
  const migratedIds: string[] = [];
  let mediaCount = 0;
  for (const [index, item] of legacyContents.entries()) {
    const categoryName = String(item.category || categoryNames[0] || "资料");
    const categoryId = categoryIds.get(categoryName);
    if (!categoryId) return json({ error: `Missing category for ${String(item.title || "content")}` }, 400);
    const legacyId = String(item.id || `legacy-${index}`);
    const status = ["published", "draft", "hidden"].includes(String(item.status)) ? String(item.status) : "draft";
    const bodyHtml = cleanBody(item.bodyHtml);
    const { data: content, error } = await client.from("contents").upsert({
      legacy_id: legacyId,
      category_id: categoryId,
      slug: slugify(legacyId),
      title: String(item.title || "未命名资料"),
      summary: String(item.summary || ""),
      body_json: {},
      body_html: bodyHtml,
      body_text: sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim(),
      source_record: String(item.source || ""),
      status,
      sort_order: Number(item.order || 100),
      created_by: user.id,
      updated_by: user.id,
      published_at: status === "published" ? new Date().toISOString() : null
    }, { onConflict: "legacy_id" }).select("id").single();
    if (error || !content) return json({ error: error?.message ?? `Unable to migrate ${legacyId}` }, 400);
    migratedIds.push(content.id);
    await client.from("content_media").delete().eq("content_id", content.id);
    await client.from("attachments").delete().eq("content_id", content.id);

    const mediaItems = Array.isArray(item.mediaItems) && item.mediaItems.length
      ? item.mediaItems as Array<Record<string, unknown>>
      : (Array.isArray(item.images) ? item.images : [item.image]).filter(Boolean).map((src) => ({ src }));
    for (const [mediaIndex, media] of mediaItems.entries()) {
      const source = String(media.src || media.url || media.image || "");
      const row: Record<string, unknown> = {
        content_id: content.id,
        kind: media.type === "video" ? "video" : "image",
        title: String(media.title || `图片 ${mediaIndex + 1}`),
        note: String(media.note || ""),
        hierarchy_path: String(media.path || categoryName).split("/").filter(Boolean),
        alt_text: String(media.title || item.title || "图片"),
        sort_order: (mediaIndex + 1) * 10,
        created_by: user.id
      };
      if (decodeDataUrl(source)) {
        const bucket = status === "published" ? "maplestorynk-public" : "maplestorynk-private";
        row.storage_bucket = bucket;
        row.storage_path = await uploadAsset(source, `legacy/content/${content.id}/${mediaIndex + 1}`, bucket);
      } else if (source.startsWith("https://")) row.external_url = source;
      else continue;
      const { error: mediaError } = await client.from("content_media").insert(row);
      if (mediaError) return json({ error: mediaError.message }, 400);
      mediaCount += 1;
    }

    const attachments = Array.isArray(item.attachments) ? item.attachments as Array<Record<string, unknown> | string> : [];
    for (const [attachmentIndex, attachment] of attachments.entries()) {
      const source = typeof attachment === "string" ? attachment : String(attachment.url || attachment.src || "");
      if (!source.startsWith("https://")) continue;
      const name = typeof attachment === "string" ? `附件 ${attachmentIndex + 1}` : String(attachment.name || `附件 ${attachmentIndex + 1}`);
      const { error: attachmentError } = await client.from("attachments").insert({ content_id: content.id, name, external_url: source, sort_order: (attachmentIndex + 1) * 10, created_by: user.id });
      if (attachmentError) return json({ error: attachmentError.message }, 400);
    }
  }

  const { count, error: countError } = migratedIds.length
    ? await client.from("contents").select("id", { count: "exact", head: true }).in("id", migratedIds)
    : { count: 0, error: null };
  if (countError || count !== legacyContents.length) return json({ error: countError?.message ?? `Content count mismatch: expected ${legacyContents.length}, got ${count}` }, 400);
  const { error: completionError } = await client.from("site_settings").update({ migration_completed: true, updated_by: user.id }).eq("id", "main");
  if (completionError) return json({ error: completionError.message }, 400);
  return json({ categories: categoryIds.size, contents: migratedIds.length, media: mediaCount, backupPath });
}));
