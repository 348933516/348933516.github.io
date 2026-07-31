import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { functionError } from "../_shared/function-errors.ts";
import { copyCosObject, cosConfiguration, CosRequestError, deleteCosObject } from "../_shared/tencent-cos.ts";

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
  if (!contentId || !Number.isFinite(expectedVersion)) return json(functionError("CONTENT_VERSION_INVALID", "Invalid content version", "validate-input"), 400);

  const { data: content, error: contentError } = await client
    .from("contents")
    .select("id, version")
    .eq("id", contentId)
    .single();
  if (contentError || !content) return json(functionError("CONTENT_NOT_FOUND", "Content not found", "load-content"), 404);
  if (content.version !== expectedVersion) {
    return json(functionError("VERSION_CONFLICT", "Content was changed by another administrator", "validate-version"), 409);
  }

  const [mediaResult, attachmentsResult] = await Promise.all([
    client.from("content_media").select("id, storage_provider, storage_bucket, storage_path, original_storage_path, display_storage_path, image_variants").eq("content_id", contentId),
    client.from("attachments").select("id, storage_provider, storage_bucket, storage_path").eq("content_id", contentId)
  ]);
  if (mediaResult.error || attachmentsResult.error) {
    return json(functionError("PUBLICATION_MEDIA_QUERY_FAILED", "Unable to read media awaiting publication", "load-media"), 500);
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
      if (error instanceof CosRequestError) {
        const accessDenied = error.httpStatus === 401 || error.httpStatus === 403 || /accessdenied|signature|auth/i.test(error.code);
        const code = accessDenied ? "COS_COPY_ACCESS_DENIED" : error.code === "COS_TIMEOUT" ? "COS_COPY_TIMEOUT" : "COS_COPY_FAILED";
        const message = accessDenied
          ? `COS 发布复制被拒绝：${error.operation}${error.requestId ? `，request ID ${error.requestId}` : ""}。请为服务端 CAM 子账号补齐私有桶 GetObject 和发布桶 PutObject 权限。`
          : `COS 发布复制失败：${error.operation}，${error.code}${error.requestId ? `，request ID ${error.requestId}` : ""}。`;
        return json(functionError(code, message, "copy-media", {
          operation: error.operation,
          http_status: error.httpStatus,
          cos_request_id: error.requestId,
          source_bucket: sourceBucket,
          destination_bucket: destinationBucket,
          media_id: item.id,
          media_table: table
        }), 502);
      }
      return json(functionError("MEDIA_PROMOTION_FAILED", error instanceof Error ? error.message : "Stored file promotion failed", "copy-media", {
        media_id: item.id,
        media_table: table
      }), 500);
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
    return json(functionError(
      conflict ? "VERSION_CONFLICT" : "PUBLICATION_COMMIT_FAILED",
      conflict ? "Content was changed by another administrator" : "Unable to commit publication",
      "commit-publication"
    ), conflict ? 409 : 500);
  }

  if (promoted.length) {
    const supabasePaths = copiedObjects.filter((item) => item.provider === "supabase").map((item) => item.source);
    if (supabasePaths.length) await client.storage.from("maplestorynk-private").remove(supabasePaths);
    await Promise.allSettled(copiedObjects.filter((item) => item.provider === "tencent_cos").map((item) => deleteCosObject(item.sourceBucket, item.source)));
  }
  return json(updated);
}));
