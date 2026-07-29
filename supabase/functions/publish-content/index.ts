import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { copyCosObject, cosConfiguration, deleteCosObject } from "../_shared/tencent-cos.ts";

type StoredItem = {
  id: string;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_storage_path?: string | null;
  display_storage_path?: string | null;
  image_variants?: Array<Record<string, unknown>> | null;
};

type ObjectCopy = {
  provider: "supabase" | "tencent_cos";
  sourceBucket: string;
  destinationBucket: string;
  source: string;
  destination: string;
};

type Promotion = {
  table: "content_media" | "attachments";
  id: string;
  provider: "supabase" | "tencent_cos";
  sourceBucket: string;
  destinationBucket: string;
  storagePath: string;
  originalStoragePath: string | null;
  displayStoragePath: string | null;
  imageVariants: Array<Record<string, unknown>>;
  objects: ObjectCopy[];
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
    client.from("content_media").select("id, storage_provider, storage_bucket, storage_path, original_storage_path, display_storage_path, image_variants").eq("content_id", contentId),
    client.from("attachments").select("id, storage_provider, storage_bucket, storage_path").eq("content_id", contentId)
  ]);
  if (mediaResult.error || attachmentsResult.error) {
    return json({ error: mediaResult.error?.message ?? attachmentsResult.error?.message }, 400);
  }

  const pending: Array<{ table: Promotion["table"]; item: StoredItem }> = [
    ...(mediaResult.data ?? []).map((item) => ({ table: "content_media" as const, item })),
    ...(attachmentsResult.data ?? []).map((item) => ({ table: "attachments" as const, item }))
  ].filter(({ item }) => Boolean(item.storage_path) && (item.storage_bucket === "maplestorynk-private" || item.storage_provider === "tencent_cos" && item.storage_bucket === cosConfiguration().privateBucket));

  const promoted: Promotion[] = [];
  const copiedObjects: ObjectCopy[] = [];
  const cleanupPublicCopies = async () => {
    const supabasePaths = copiedObjects.filter((item) => item.provider === "supabase").map((item) => item.destination);
    if (supabasePaths.length) await client.storage.from("maplestorynk-public").remove(supabasePaths);
    await Promise.allSettled(copiedObjects.filter((item) => item.provider === "tencent_cos").map((item) => deleteCosObject(item.destinationBucket, item.destination)));
  };

  for (const { table, item } of pending) {
    const provider = item.storage_provider === "tencent_cos" ? "tencent_cos" : "supabase";
    const configuration = provider === "tencent_cos" ? cosConfiguration() : null;
    const sourceBucket = configuration?.privateBucket || "maplestorynk-private";
    const destinationBucket = configuration?.publicBucket || "maplestorynk-public";
    const paths = [...new Set([
      item.storage_path,
      item.original_storage_path,
      item.display_storage_path,
      ...(Array.isArray(item.image_variants) ? item.image_variants.map((variant) => String(variant.path || "")) : [])
    ].filter(Boolean).map(String))];
    const copiedBySource = new Map<string, string>();
    try {
      for (const source of paths) {
        const filename = source.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || crypto.randomUUID();
        const destination = `content/${contentId}/${table}/${item.id}/${crypto.randomUUID()}-${filename}`;
        if (provider === "tencent_cos") {
          await copyCosObject(sourceBucket, source, destinationBucket, destination);
        } else {
          const { data: file, error: downloadError } = await client.storage.from(sourceBucket).download(source);
          if (downloadError || !file) throw new Error(downloadError?.message ?? "Stored file download failed");
          const { error: uploadError } = await client.storage.from(destinationBucket).upload(destination, file, { contentType: file.type || "application/octet-stream", upsert: false });
          if (uploadError) throw new Error(uploadError.message);
        }
        copiedBySource.set(source, destination);
        copiedObjects.push({ provider, sourceBucket, destinationBucket, source, destination });
      }
    } catch (error) {
      await cleanupPublicCopies();
      return json({ error: error instanceof Error ? error.message : "Stored file promotion failed" }, 400);
    }
    promoted.push({
      table,
      id: item.id,
      provider,
      sourceBucket,
      destinationBucket,
      storagePath: copiedBySource.get(item.storage_path as string) as string,
      originalStoragePath: item.original_storage_path ? copiedBySource.get(item.original_storage_path) || null : null,
      displayStoragePath: item.display_storage_path ? copiedBySource.get(item.display_storage_path) || null : null,
      imageVariants: (Array.isArray(item.image_variants) ? item.image_variants : []).map((variant) => ({
        ...variant,
        path: copiedBySource.get(String(variant.path || "")) || String(variant.path || "")
      })),
      objects: copiedObjects.filter((copy) => copiedBySource.get(copy.source) === copy.destination)
    });
  }

  const { data: committed, error: commitError } = await client.rpc("commit_content_publication", {
    p_content_id: contentId,
    p_expected_version: expectedVersion,
    p_actor_id: user.id,
    p_promotions: promoted
  });
  const updated = Array.isArray(committed) ? committed[0] : committed;
  if (commitError || !updated) {
    await cleanupPublicCopies();
    const conflict = commitError?.message?.includes("VERSION_CONFLICT");
    return json({ error: conflict ? "Content was changed by another administrator" : commitError?.message ?? "Unable to commit publication", code: conflict ? "VERSION_CONFLICT" : "PUBLICATION_COMMIT_FAILED" }, conflict ? 409 : 500);
  }

  if (promoted.length) {
    const supabasePaths = copiedObjects.filter((item) => item.provider === "supabase").map((item) => item.source);
    if (supabasePaths.length) await client.storage.from("maplestorynk-private").remove(supabasePaths);
    await Promise.allSettled(copiedObjects.filter((item) => item.provider === "tencent_cos").map((item) => deleteCosObject(item.sourceBucket, item.source)));
  }
  return json(updated);
}));
