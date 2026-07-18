import sanitizeHtml from "npm:sanitize-html@2.17.0";
import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

const allowedStatuses = ["draft", "published", "hidden", "trashed"];

function cleanSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

function cleanBody(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "code", "pre", "hr", "span"],
    allowedAttributes: { a: ["href", "target", "rel", "title"], img: ["src", "alt", "title"], th: ["colspan", "rowspan"], td: ["colspan", "rowspan"], span: ["class"] },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) }
  });
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
    return json(data);
  }
  const { data, error } = await client.from("contents").update(payload).eq("id", existing.id).eq("version", expectedVersion).select("*").maybeSingle();
  if (error || !data) return json({ error: error?.message ?? "Content version changed", code: "VERSION_CONFLICT" }, 409);
  return json(data);
}));
