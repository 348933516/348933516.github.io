import { cosPublicBucket, cosPublicStorageAlias, mediaBaseUrl, publicMediaBucket } from "./config";
import { safeUrl } from "./sanitize";
import { supabase } from "./supabase";

export type StorageProvider = "supabase" | "tencent_cos";

export function encodeStoragePath(path: string) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function edgeMediaUrl(path?: string | null) {
  return path ? safeUrl(`${mediaBaseUrl}/${encodeStoragePath(path)}`) : "";
}

export function publicStorageUrl(input: {
  provider?: string | null;
  bucket?: string | null;
  path?: string | null;
  externalUrl?: string | null;
}) {
  if (input.externalUrl) return safeUrl(input.externalUrl);
  if (!input.path) return "";
  if (input.provider === "tencent_cos") {
    if (input.bucket !== cosPublicBucket && input.bucket !== cosPublicStorageAlias) return "";
    return edgeMediaUrl(input.path);
  }
  if (input.bucket === cosPublicStorageAlias) return edgeMediaUrl(input.path);
  if (!input.bucket || input.bucket !== publicMediaBucket) return "";
  return safeUrl(supabase.storage.from(input.bucket).getPublicUrl(input.path).data.publicUrl);
}

export function storedAssetUrl(path?: string | null, provider?: string | null) {
  if (!path) return "";
  return provider === "tencent_cos" ? edgeMediaUrl(path) : publicStorageUrl({ bucket: publicMediaBucket, path });
}

export async function removeStoredObjects(input: {
  provider?: string | null;
  bucket: string;
  paths: string[];
  contentId?: string;
}) {
  const paths = [...new Set(input.paths.filter(Boolean))];
  if (!paths.length) return;
  if (input.provider === "tencent_cos") {
    for (const path of paths) {
      const { data, error } = await supabase.functions.invoke("cos-storage", {
        body: { action: "delete", bucket: input.bucket, path, contentId: input.contentId }
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "COS object cleanup failed");
    }
    return;
  }
  const { error } = await supabase.storage.from(input.bucket).remove(paths);
  if (error) throw error;
}
