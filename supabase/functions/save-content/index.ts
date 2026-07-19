import sanitizeHtml from "npm:sanitize-html@2.17.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

const allowedStatuses = ["draft", "published", "hidden", "trashed"];

function cleanSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

function cleanBody(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "code", "pre", "hr", "span", "mark", "div"],
    allowedAttributes: {
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "title"],
      figure: ["data-editor-image"],
      figcaption: ["data-placeholder"],
      table: ["data-table-border", "data-table-style", "data-table-color", "style"],
      th: ["colspan", "rowspan", "colwidth", "data-cell-background", "data-cell-align", "style"],
      td: ["colspan", "rowspan", "colwidth", "data-cell-background", "data-cell-align", "style"],
      span: ["class", "data-font-family", "data-font-size", "data-text-color", "data-highlight", "style"],
      mark: ["data-highlight", "style"],
      div: ["class"]
    },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{6}$/i],
        "background-color": [/^#[0-9a-f]{6}$/i],
        "font-size": [/^(?:[8-9]|[1-6][0-9]|7[0-2])px$/],
        "text-align": [/^(left|center|right|justify)$/],
        "border-color": [/^#[0-9a-f]{6}$/i],
        "--rich-table-color": [/^#[0-9a-f]{6}$/i]
      }
    },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) }
  });
}

async function syncTags(client: SupabaseClient, contentId: string, value: unknown) {
  const names = Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 20)
    : [];
  const { error: clearError } = await client.from("content_tags").delete().eq("content_id", contentId);
  if (clearError) throw clearError;
  if (!names.length) return;
  const rows = names.map((name) => ({ name: name.slice(0, 80), slug: cleanSlug(name).slice(0, 100) || `tag-${crypto.randomUUID().slice(0, 8)}` }));
  const { error: upsertError } = await client.from("tags").upsert(rows, { onConflict: "name", ignoreDuplicates: true });
  if (upsertError) throw upsertError;
  const { data: tags, error: tagsError } = await client.from("tags").select("id, name").in("name", rows.map((row) => row.name));
  if (tagsError) throw tagsError;
  const { error: linkError } = await client.from("content_tags").insert((tags ?? []).map((tag) => ({ content_id: contentId, tag_id: tag.id })));
  if (linkError) throw linkError;
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const action = String(body.action ?? "save");
  const contentId = body.id ? String(body.id) : "";
  const expectedVersion = Number(body.version || 1);

  if (action === "status") {
    const status = String(body.status);
    if (!contentId || !["draft", "hidden", "trashed"].includes(status)) return json({ error: "Invalid status request" }, 400);
    if (status === "trashed" && profile.role !== "super_admin") return json({ error: "Only a super administrator can move content to trash" }, 403);
    if (profile.role === "uploader") return json({ error: "Uploaders cannot change publication status" }, 403);
    const { data, error } = await client.from("contents").update({ status, updated_by: user.id }).eq("id", contentId).eq("version", expectedVersion).select("*").maybeSingle();
    if (error || !data) return json({ error: error?.message ?? "Content version changed", code: "VERSION_CONFLICT" }, 409);
    return json(data);
  }

  const title = String(body.title ?? "").trim();
  const categoryId = String(body.categoryId ?? "");
  const summary = String(body.summary ?? "").trim();
  const rawBody = String(body.bodyHtml ?? "");
  if (!title || title.length > 200 || !categoryId || summary.length > 5000 || rawBody.length > 1_000_000) {
    return json({ error: "Invalid or oversized content" }, 400);
  }

  let existing: Record<string, unknown> | null = null;
  if (contentId) {
    const result = await client.from("contents").select("*").eq("id", contentId).maybeSingle();
    if (result.error) return json({ error: result.error.message }, 400);
    existing = result.data;
  } else if (body.legacyId && profile.role === "super_admin") {
    const result = await client.from("contents").select("*").eq("legacy_id", String(body.legacyId)).maybeSingle();
    if (result.error) return json({ error: result.error.message }, 400);
    existing = result.data;
  }
  if (contentId && !existing) return json({ error: "Content not found" }, 404);
  if (existing && Number(existing.version) !== expectedVersion) return json({ error: "Content version changed", code: "VERSION_CONFLICT" }, 409);
  if (profile.role === "uploader" && existing && (existing.created_by !== user.id || existing.status !== "draft")) {
    return json({ error: "Uploaders can only edit their own drafts" }, 403);
  }

  let status = String(body.status ?? "draft");
  if (!allowedStatuses.includes(status)) status = "draft";
  if (profile.role === "uploader") status = "draft";
  if (status === "trashed") return json({ error: "Use the trash action instead" }, 400);
  if (status === "published" && existing?.status !== "published") return json({ error: "Use the publish action after saving the draft" }, 400);
  const cleanedBody = cleanBody(rawBody);
  const payload = {
    legacy_id: body.legacyId ? String(body.legacyId) : existing?.legacy_id ?? null,
    category_id: categoryId,
    slug: cleanSlug(String(body.slug || title)) || `content-${crypto.randomUUID()}`,
    title,
    summary,
    body_json: body.bodyJson && typeof body.bodyJson === "object" ? body.bodyJson : {},
    body_html: cleanedBody,
    body_text: sanitizeHtml(cleanedBody, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim(),
    source_record: String(body.sourceRecord ?? "").slice(0, 20_000),
    status,
    is_featured: profile.role === "uploader" ? false : Boolean(body.featured),
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
    updated_by: user.id
  };

  if (!existing) {
    const { data, error } = await client.from("contents").insert({ ...payload, created_by: user.id }).select("*").single();
    if (error) return json({ error: error.message }, 400);
    try { await syncTags(client, data.id, body.tags); return json(data); }
    catch (tagError) { console.error(tagError); return json({ ...data, tagWarning: "正文已保存，但标签暂时无法同步" }); }
  }
  const { data, error } = await client.from("contents").update(payload).eq("id", existing.id).eq("version", expectedVersion).select("*").maybeSingle();
  if (error || !data) return json({ error: error?.message ?? "Content version changed", code: "VERSION_CONFLICT" }, 409);
  try { await syncTags(client, data.id, body.tags); return json(data); }
  catch (tagError) { console.error(tagError); return json({ ...data, tagWarning: "正文已保存，但标签暂时无法同步" }); }
}));
