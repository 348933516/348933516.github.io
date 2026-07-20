import sanitizeHtml from "npm:sanitize-html@2.17.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

type ImportAsset = {
  mediaId: string;
  originalPath: string;
  displayPath: string;
  hash: string;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  displaySize: number;
  sortOrder: number;
  title: string;
  altText: string;
};

const publicBucket = "maplestorynk-public";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/i;

function cleanBody(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption", "code", "pre", "hr", "span", "mark", "div"],
    allowedAttributes: {
      a: ["href", "target", "rel", "title"], img: ["src", "alt", "title"],
      figure: ["data-editor-image", "data-media-id"], figcaption: ["data-placeholder"],
      table: ["data-table-border", "data-table-style", "data-table-color", "style"],
      th: ["colspan", "rowspan", "colwidth", "data-cell-background", "data-cell-align", "style"],
      td: ["colspan", "rowspan", "colwidth", "data-cell-background", "data-cell-align", "style"],
      span: ["class", "data-font-family", "data-font-size", "data-text-color", "data-highlight", "style"],
      mark: ["data-highlight", "style"], div: ["class"]
    },
    allowedStyles: { "*": {
      color: [/^#[0-9a-f]{6}$/i], "background-color": [/^#[0-9a-f]{6}$/i],
      "font-size": [/^(?:[8-9]|[1-6][0-9]|7[0-2])px$/], "text-align": [/^(left|center|right|justify)$/],
      "border-color": [/^#[0-9a-f]{6}$/i], "border-width": [/^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/],
      "border-style": [/^(solid|dashed|dotted|double|groove|ridge|none)$/],
      "--rich-table-color": [/^#[0-9a-f]{6}$/i], "--rich-table-border": [/^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/],
      "--rich-table-style": [/^(solid|dashed|dotted|double|groove|ridge|none)$/]
    } },
    allowedSchemes: ["https"], allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) }
  });
}

function validAsset(value: unknown, importId: string): value is ImportAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Record<string, unknown>;
  const prefix = `imports/${importId}/`;
  return uuid.test(String(asset.mediaId || "")) && hash.test(String(asset.hash || ""))
    && String(asset.originalPath || "").startsWith(prefix) && String(asset.displayPath || "").startsWith(prefix)
    && Number.isInteger(Number(asset.width)) && Number(asset.width) > 0 && Number.isInteger(Number(asset.height)) && Number(asset.height) > 0
    && Number(asset.originalSize) > 0 && Number(asset.displaySize) > 0;
}

async function removeManifestFiles(client: SupabaseClient, manifest: unknown) {
  if (!Array.isArray(manifest)) return;
  const paths = manifest.flatMap((asset) => asset && typeof asset === "object" ? [String((asset as Record<string, unknown>).originalPath || ""), String((asset as Record<string, unknown>).displayPath || "")] : []).filter(Boolean);
  if (paths.length) await client.storage.from(publicBucket).remove(paths);
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
    if (!uuid.test(contentId) || !Number.isInteger(expectedImages) || expectedImages < 1 || expectedImages > 250 || !Number.isInteger(expectedVersion) || expectedVersion < 1 || totalOriginalBytes < 1) return json({ error: "Invalid import request" }, 400);
    const { data: content, error } = await client.from("contents").select("id, version, created_by, status").eq("id", contentId).maybeSingle();
    if (error || !content) return json({ error: error?.message || "Content not found" }, 404);
    if (content.version !== expectedVersion) return json({ error: "Content version changed", code: "VERSION_CONFLICT" }, 409);
    if (profile.role === "uploader" && (content.created_by !== user.id || content.status !== "draft")) return json({ error: "Uploaders can only import into their own drafts" }, 403);
    const id = crypto.randomUUID();
    const { error: insertError } = await client.from("document_imports").insert({ id, content_id: contentId, created_by: user.id, expected_images: expectedImages, total_original_bytes: totalOriginalBytes });
    if (insertError) return json({ error: insertError.message }, 400);
    return json({ id, uploadPrefix: `imports/${id}` });
  }

  const importId = String(body.importId || "");
  if (!uuid.test(importId)) return json({ error: "Invalid import id" }, 400);
  const { data: job, error: jobError } = await client.from("document_imports").select("*").eq("id", importId).maybeSingle();
  if (jobError || !job) return json({ error: jobError?.message || "Import not found" }, 404);
  if (job.created_by !== user.id && profile.role !== "super_admin") return json({ error: "Import forbidden" }, 403);

  if (action === "cancel" || action === "fail") {
    const manifest = Array.isArray(body.manifest) ? body.manifest : job.manifest;
    await removeManifestFiles(client, manifest);
    const { error } = await client.from("document_imports").update({ status: action === "cancel" ? "cancelled" : "failed", manifest, error_message: String(body.error || "").slice(0, 2000) }).eq("id", importId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action !== "finalize") return json({ error: "Unsupported import action" }, 400);
  const assets = Array.isArray(body.assets) ? body.assets : [];
  if (job.status !== "uploading" || assets.length !== job.expected_images || !assets.every((asset) => validAsset(asset, importId))) return json({ error: "Import manifest is incomplete" }, 400);
  const paths = assets.flatMap((asset) => [asset.originalPath, asset.displayPath]);
  const { data: stored, error: storedError } = await client.schema("storage").from("objects").select("name").eq("bucket_id", publicBucket).in("name", paths);
  if (storedError || (stored?.length || 0) !== paths.length) return json({ error: storedError?.message || "One or more uploaded images are missing" }, 400);

  const cleaned = cleanBody(String(body.bodyHtml || ""));
  if (!cleaned.trim() || cleaned.length > 1_000_000) return json({ error: "Imported content is empty or too large" }, 400);
  const text = sanitizeHtml(cleaned, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
  const { data, error } = await client.rpc("finalize_document_import", {
    p_import_id: importId, p_content_id: job.content_id, p_expected_version: Number(body.expectedVersion || 0), p_actor_id: user.id,
    p_body_html: cleaned, p_body_text: text, p_source_record: String(body.sourceRecord || "").slice(0, 20000), p_manifest: assets
  }).single();
  if (error) {
    await client.from("document_imports").update({ status: "failed", manifest: assets, error_message: error.message.slice(0, 2000) }).eq("id", importId);
    return json({ error: error.message, code: error.message.includes("VERSION_CONFLICT") ? "VERSION_CONFLICT" : undefined }, 409);
  }
  return json(data);
}));
