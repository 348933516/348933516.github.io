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
  poster_storage_path?: string | null;
  image_variants?: Array<Record<string, unknown>> | null;
  mime_type?: string | null;
  original_mime_type?: string | null;
  kind?: string | null;
  processing_status?: string | null;
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
  posterStoragePath: string | null;
  posterUrl: string | null;
  imageVariants: Array<Record<string, unknown>>;
  objects: ObjectCopy[];
};

function contentTypeFromPath(path: string) {
  const extension = path.split("?")[0].split(".").pop()?.toLowerCase();
  return ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm",
    pdf: "application/pdf",
    zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain"
  } as Record<string, string>)[extension || ""] || "application/octet-stream";
}

function contentTypeForSource(item: StoredItem, source: string) {
  if (source === item.poster_storage_path) return "image/webp";
  const variant = (Array.isArray(item.image_variants) ? item.image_variants : [])
    .find((candidate) => String(candidate.path || "") === source);
  const variantMime = String(variant?.mimeType || variant?.mime_type || "");
  if (variantMime.includes("/")) return variantMime;
  if (source === item.original_storage_path && item.original_mime_type?.includes("/")) return item.original_mime_type;
  if (source === item.storage_path && item.mime_type?.includes("/")) return item.mime_type;
  return contentTypeFromPath(source);
}

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

  const mediaResult = await client.from("content_media").select("id, kind, storage_provider, storage_bucket, storage_path, original_storage_path, display_storage_path, poster_storage_path, image_variants, mime_type, original_mime_type, processing_status").eq("content_id", contentId);
  if (mediaResult.error) {
    return json(functionError("PUBLICATION_MEDIA_QUERY_FAILED", "Unable to read media awaiting publication", "load-media"), 500);
  }
  const configuration = cosConfiguration();
  const unfinishedVideo = (mediaResult.data ?? []).find((item) => {
    if (item.kind !== "video" || item.processing_status === "ready") return false;
    const hasPublishedFallback = item.storage_provider === "tencent_cos"
      ? item.storage_bucket === configuration.publicBucket
      : item.storage_bucket === "maplestorynk-public";
    return !hasPublishedFallback;
  });
  if (unfinishedVideo) {
    return json(functionError("VIDEO_PROCESSING_PENDING", "视频仍在生成兼容播放版本，请处理完成后再发布。", "validate-media", { media_id: unfinishedVideo.id, processing_status: unfinishedVideo.processing_status }), 409);
  }

  const pending: Array<{ table: Promotion["table"]; item: StoredItem }> = [
    ...(mediaResult.data ?? []).map((item) => ({ table: "content_media" as const, item }))
  ].filter(({ item }) => Boolean(item.storage_path) && (item.storage_bucket === "maplestorynk-private" || item.storage_provider === "tencent_cos" && item.storage_bucket === configuration.privateBucket));

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
      item.poster_storage_path,
      ...(Array.isArray(item.image_variants) ? item.image_variants.map((variant) => String(variant.path || "")) : [])
    ].filter(Boolean).map(String))];
    const copiedBySource = new Map<string, string>();
    try {
      for (const source of paths) {
        const filename = source.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || crypto.randomUUID();
        const destination = `content/${contentId}/${table}/${item.id}/${crypto.randomUUID()}-${filename}`;
        if (provider === "tencent_cos") {
          const cacheControl = table === "attachments"
            ? "public, max-age=604800, immutable"
            : item.kind === "video" && source === item.storage_path
              ? "public, max-age=2592000, immutable"
              : "public, max-age=31536000, immutable";
          await copyCosObject(sourceBucket, source, destinationBucket, destination, {
            cacheControl,
            sourceContentType: contentTypeForSource(item, source),
            verifyDestination: false
          });
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
      posterStoragePath: item.poster_storage_path ? copiedBySource.get(item.poster_storage_path) || null : null,
      posterUrl: item.poster_storage_path
        ? provider === "tencent_cos"
          ? `${configuration?.mediaBaseUrl}/${String(copiedBySource.get(item.poster_storage_path) || "").split("/").map(encodeURIComponent).join("/")}`
          : client.storage.from(destinationBucket).getPublicUrl(String(copiedBySource.get(item.poster_storage_path) || "")).data.publicUrl
        : null,
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
    const databaseCode = String(commitError?.code ?? "").slice(0, 40);
    const databaseMessage = String(commitError?.message ?? "Publication transaction returned no row")
      .replace(/\s+/g, " ")
      .slice(0, 300);
    return json(functionError(
      conflict ? "VERSION_CONFLICT" : "PUBLICATION_COMMIT_FAILED",
      conflict
        ? "Content was changed by another administrator"
        : `数据库发布事务失败${databaseCode ? `（${databaseCode}）` : ""}，请重试；若持续失败，请记录请求 ID。`,
      "commit-publication",
      {
        database_code: databaseCode || null,
        database_message: databaseMessage
      }
    ), conflict ? 409 : 500);
  }

  if (promoted.length) {
    const supabasePaths = copiedObjects.filter((item) => item.provider === "supabase").map((item) => item.source);
    if (supabasePaths.length) await client.storage.from("maplestorynk-private").remove(supabasePaths);
    await Promise.allSettled(copiedObjects.filter((item) => item.provider === "tencent_cos").map((item) => deleteCosObject(item.sourceBucket, item.source)));
  }
  return json(updated);
}));
