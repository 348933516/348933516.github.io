import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

type StoredItem = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type Promotion = {
  table: "content_media" | "attachments";
  id: string;
  source: string;
  destination: string;
};

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user } = await requireRole(request, ["super_admin", "editor"]);
  const body = await request.json();
  const contentId = String(body.contentId ?? "");
  const expectedVersion = Number(body.version);
  if (!contentId || !Number.isFinite(expectedVersion)) return json({ error: "Invalid content version" }, 400);

  const { data: content, error: contentError } = await client
    .from("contents")
    .select("id, version")
    .eq("id", contentId)
    .single();
  if (contentError || !content) return json({ error: contentError?.message ?? "Content not found" }, 404);
  if (content.version !== expectedVersion) {
    return json({ error: "Content was changed by another administrator", code: "VERSION_CONFLICT" }, 409);
  }

  const [mediaResult, attachmentsResult] = await Promise.all([
    client.from("content_media").select("id, storage_bucket, storage_path").eq("content_id", contentId),
    client.from("attachments").select("id, storage_bucket, storage_path").eq("content_id", contentId)
  ]);
  if (mediaResult.error || attachmentsResult.error) {
    return json({ error: mediaResult.error?.message ?? attachmentsResult.error?.message }, 400);
  }

  const pending: Array<{ table: Promotion["table"]; item: StoredItem }> = [
    ...(mediaResult.data ?? []).map((item) => ({ table: "content_media" as const, item })),
    ...(attachmentsResult.data ?? []).map((item) => ({ table: "attachments" as const, item }))
  ].filter(({ item }) => item.storage_bucket === "maplestorynk-private" && Boolean(item.storage_path));

  const promoted: Promotion[] = [];
  const cleanupPublicCopies = async () => {
    if (promoted.length) {
      await client.storage.from("maplestorynk-public").remove(promoted.map((item) => item.destination));
    }
  };

  for (const { table, item } of pending) {
    const source = item.storage_path as string;
    const filename = source.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || crypto.randomUUID();
    const destination = `content/${contentId}/${table}/${crypto.randomUUID()}-${filename}`;
    const { data: file, error: downloadError } = await client.storage.from("maplestorynk-private").download(source);
    if (downloadError || !file) {
      await cleanupPublicCopies();
      return json({ error: downloadError?.message ?? "Stored file download failed" }, 400);
    }
    const { error: uploadError } = await client.storage.from("maplestorynk-public").upload(destination, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });
    if (uploadError) {
      await cleanupPublicCopies();
      return json({ error: uploadError.message }, 400);
    }
    promoted.push({ table, id: item.id, source, destination });
  }

  const { data: updated, error: updateError } = await client
    .from("contents")
    .update({ status: "published", updated_by: user.id })
    .eq("id", contentId)
    .eq("version", expectedVersion)
    .select("id, version, status, published_at")
    .maybeSingle();
  if (updateError || !updated) {
    await cleanupPublicCopies();
    return json({ error: updateError?.message ?? "Content version changed", code: "VERSION_CONFLICT" }, 409);
  }

  const updatedFiles: Promotion[] = [];
  for (const item of promoted) {
    const { error } = await client.from(item.table).update({
      storage_bucket: "maplestorynk-public",
      storage_path: item.destination
    }).eq("id", item.id);
    if (error) {
      for (const changed of updatedFiles) {
        await client.from(changed.table).update({
          storage_bucket: "maplestorynk-private",
          storage_path: changed.source
        }).eq("id", changed.id);
      }
      await client.from("contents").update({ status: "draft", updated_by: user.id }).eq("id", contentId);
      await cleanupPublicCopies();
      return json({ error: `Unable to publish stored files: ${error.message}` }, 500);
    }
    updatedFiles.push(item);
  }

  if (promoted.length) {
    await client.storage.from("maplestorynk-private").remove(promoted.map((item) => item.source));
  }
  return json(updated);
}));
