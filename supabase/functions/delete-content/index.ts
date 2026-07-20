import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

type DeleteItem = { id: string; version: number };
type StoredRow = { storage_bucket: string | null; storage_path: string | null; original_storage_path?: string | null; display_storage_path?: string | null };

function normalizeItems(value: unknown): DeleteItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((item) => ({
    id: String((item as Record<string, unknown>)?.id ?? ""),
    version: Number((item as Record<string, unknown>)?.version)
  })).filter((item) => item.id && Number.isFinite(item.version));
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client } = await requireRole(request, ["super_admin"]);
  const body = await request.json();
  const items = normalizeItems(body.items);
  if (!items.length) return json({ error: "No content was selected" }, 400);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  const storageByBucket = new Map<string, string[]>();
  const storageWarnings: string[] = [];

  for (const item of items) {
    const { data: content, error: contentError } = await client
      .from("contents")
      .select("id, version, status")
      .eq("id", item.id)
      .maybeSingle();
    if (contentError || !content) {
      results.push({ id: item.id, ok: false, error: contentError?.message ?? "Content not found" });
      continue;
    }
    if (content.status !== "trashed") {
      results.push({ id: item.id, ok: false, error: "Move content to trash before deleting forever" });
      continue;
    }
    if (Number(content.version) !== item.version) {
      results.push({ id: item.id, ok: false, error: "VERSION_CONFLICT" });
      continue;
    }

    const [mediaResult, attachmentResult] = await Promise.all([
      client.from("content_media").select("storage_bucket, storage_path, original_storage_path, display_storage_path").eq("content_id", item.id),
      client.from("attachments").select("storage_bucket, storage_path").eq("content_id", item.id)
    ]);
    if (mediaResult.error || attachmentResult.error) {
      results.push({ id: item.id, ok: false, error: mediaResult.error?.message ?? attachmentResult.error?.message });
      continue;
    }

    for (const row of [...(mediaResult.data ?? []), ...(attachmentResult.data ?? [])] as StoredRow[]) {
      if (!row.storage_bucket) continue;
      const paths = [row.storage_path, row.original_storage_path, row.display_storage_path].filter(Boolean) as string[];
      storageByBucket.set(row.storage_bucket, [...(storageByBucket.get(row.storage_bucket) ?? []), ...paths]);
    }

    const { error: deleteError } = await client.from("contents").delete().eq("id", item.id).eq("version", item.version);
    results.push(deleteError ? { id: item.id, ok: false, error: deleteError.message } : { id: item.id, ok: true });
  }

  const cleanup = async () => {
    for (const [bucket, paths] of storageByBucket.entries()) {
      if (!paths.length) continue;
      const { error } = await client.storage.from(bucket).remove([...new Set(paths)]);
      if (error) storageWarnings.push(`${bucket}: ${error.message}`);
    }
  };
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (storageByBucket.size && runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(cleanup());
  } else {
    await cleanup();
  }

  return json({
    results,
    succeeded: results.filter((item) => item.ok).length,
    storageWarnings,
    storageCleanupQueued: storageByBucket.size > 0
  });
}));
