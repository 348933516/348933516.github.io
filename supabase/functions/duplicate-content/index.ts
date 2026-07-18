import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

type StoredRow = {
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  [key: string]: unknown;
};

function copyFields(row: StoredRow, contentId: string, storagePath?: string) {
  const { id: _id, created_at: _createdAt, content_id: _contentId, ...fields } = row;
  return {
    ...fields,
    content_id: contentId,
    storage_bucket: storagePath ? "maplestorynk-private" : row.storage_bucket,
    storage_path: storagePath ?? row.storage_path
  };
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user } = await requireRole(request, ["super_admin", "editor", "uploader"]);
  const body = await request.json();
  const sourceId = String(body.contentId ?? "");
  if (!sourceId) return json({ error: "A source content id is required" }, 400);

  const { data: source, error: sourceError } = await client.from("contents").select("*").eq("id", sourceId).maybeSingle();
  if (sourceError || !source) return json({ error: sourceError?.message ?? "Content not found" }, 404);

  const copySuffix = crypto.randomUUID().slice(0, 8);
  const { data: duplicate, error: duplicateError } = await client.from("contents").insert({
    category_id: source.category_id,
    slug: `${source.slug}-copy-${copySuffix}`.slice(0, 160),
    title: `${source.title} 副本`.slice(0, 200),
    summary: source.summary,
    body_json: source.body_json,
    body_html: source.body_html,
    body_text: source.body_text,
    source_record: source.source_record,
    status: "draft",
    is_featured: false,
    sort_order: source.sort_order,
    created_by: user.id,
    updated_by: user.id
  }).select("*").single();
  if (duplicateError || !duplicate) return json({ error: duplicateError?.message ?? "Unable to create duplicate" }, 400);

  const uploadedPaths: string[] = [];
  try {
    const [mediaResult, attachmentResult, tagResult] = await Promise.all([
      client.from("content_media").select("*").eq("content_id", sourceId).order("sort_order"),
      client.from("attachments").select("*").eq("content_id", sourceId).order("sort_order"),
      client.from("content_tags").select("tag_id").eq("content_id", sourceId)
    ]);
    if (mediaResult.error || attachmentResult.error || tagResult.error) {
      throw new Error(mediaResult.error?.message ?? attachmentResult.error?.message ?? tagResult.error?.message);
    }

    const copyStoredRows = async (table: "content_media" | "attachments", rows: StoredRow[]) => {
      const records: Record<string, unknown>[] = [];
      for (const row of rows) {
        let destination: string | undefined;
        if (row.storage_bucket && row.storage_path) {
          const { data: file, error } = await client.storage.from(row.storage_bucket).download(row.storage_path);
          if (error || !file) throw new Error(error?.message ?? "Unable to copy stored file");
          const filename = row.storage_path.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || "file";
          destination = `${user.id}/${duplicate.id}/copies/${crypto.randomUUID()}-${filename}`;
          const { error: uploadError } = await client.storage.from("maplestorynk-private").upload(destination, file, {
            contentType: file.type || String(row.mime_type || "application/octet-stream"), upsert: false
          });
          if (uploadError) throw new Error(uploadError.message);
          uploadedPaths.push(destination);
        }
        records.push(copyFields(row, duplicate.id, destination));
      }
      if (records.length) {
        const { error } = await client.from(table).insert(records);
        if (error) throw new Error(error.message);
      }
    };

    await copyStoredRows("content_media", mediaResult.data ?? []);
    await copyStoredRows("attachments", attachmentResult.data ?? []);
    if (tagResult.data?.length) {
      const { error } = await client.from("content_tags").insert(tagResult.data.map((row) => ({ content_id: duplicate.id, tag_id: row.tag_id })));
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from("maplestorynk-private").remove(uploadedPaths);
    await client.from("contents").delete().eq("id", duplicate.id);
    return json({ error: error instanceof Error ? error.message : "Unable to copy content" }, 500);
  }

  return json({ id: duplicate.id, title: duplicate.title, version: duplicate.version });
}));
