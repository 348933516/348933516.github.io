import type COS from "cos-js-sdk-v5";
import { cosPrivateBucket, cosPublicBucket, cosRegion, cosStorageEnabled } from "./config";
import type { UploadProgress } from "./uploads";
import { EdgeFunctionError, invokeEdgeFunction } from "./edgeFunctions";

export type CosUploadPurpose = "content-media" | "document-import" | "site-asset" | "migration";

export interface CosUploadScope {
  purpose: CosUploadPurpose;
  contentId?: string;
  importId?: string;
  prefix: string;
  visibility: "private" | "public";
}

export interface CosStoredObject {
  provider: "tencent_cos";
  bucket: string;
  region: string;
  path: string;
  etag: string;
  sizeBytes: number;
}

type TemporaryCredentials = {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  startTime: number;
  expiredTime: number;
  bucket: string;
  region: string;
  prefix: string;
};

const credentialCache = new Map<string, TemporaryCredentials>();

function scopeKey(scope: CosUploadScope) {
  return [scope.purpose, scope.contentId || "", scope.importId || "", scope.visibility, scope.prefix].join(":");
}

function validateObjectPath(path: string, prefix: string) {
  const normalized = path.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || !normalized.startsWith(prefix.replace(/^\/+/, ""))) {
    throw new Error("COS 对象路径不在当前授权范围内");
  }
  return normalized;
}

async function credentialsFor(scope: CosUploadScope) {
  if (!cosStorageEnabled) throw new Error("COS 尚未启用，请先配置腾讯云私有桶与 Supabase Secrets");
  const key = scopeKey(scope);
  const cached = credentialCache.get(key);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiredTime - now > 120) return cached;
  const value = await invokeEdgeFunction<TemporaryCredentials>("cos-credentials", { ...scope }, "credentials");
  if (!value.tmpSecretId || !value.tmpSecretKey || !value.sessionToken || !value.expiredTime) {
    throw new EdgeFunctionError({
      functionName: "cos-credentials",
      stage: "credentials",
      status: 502,
      code: "COS_CREDENTIALS_INVALID",
      message: "COS temporary credentials response is incomplete"
    });
  }
  credentialCache.set(key, value);
  return value;
}

function sdkCredentials(value: TemporaryCredentials): COS.Credentials {
  return {
    TmpSecretId: value.tmpSecretId,
    TmpSecretKey: value.tmpSecretKey,
    XCosSecurityToken: value.sessionToken,
    StartTime: value.startTime,
    ExpiredTime: value.expiredTime,
    ScopeLimit: true
  };
}

async function createClient(scope: CosUploadScope, initialCredentials: TemporaryCredentials) {
  const { default: CosClient } = await import("cos-js-sdk-v5");
  let lastCredentials = initialCredentials;
  let authorizationError: unknown = null;
  const client = new CosClient({
    ChunkRetryTimes: 4,
    ChunkSize: 5 * 1024 * 1024,
    SliceSize: 5 * 1024 * 1024,
    FileParallelLimit: 1,
    ChunkParallelLimit: 2,
    ProgressInterval: 250,
    getAuthorization: async (_options, callback) => {
      try {
        const value = await credentialsFor(scope);
        lastCredentials = value;
        callback(sdkCredentials(value));
      } catch (error) {
        // The SDK has no error callback. Reuse the last credential so the
        // actual STS/Edge Function error can be rethrown by uploadToCos.
        authorizationError = error;
        callback(sdkCredentials(lastCredentials));
      }
    }
  });
  return { client, getAuthorizationError: () => authorizationError };
}

export async function uploadToCos(input: {
  file: Blob;
  path: string;
  scope: CosUploadScope;
  contentType?: string;
  cacheControl?: string;
  signal?: AbortSignal;
  onProgress?(progress: UploadProgress): void;
}) {
  const credentials = await credentialsFor(input.scope);
  const path = validateObjectPath(input.path, credentials.prefix);
  const expectedBucket = input.scope.visibility === "public" ? cosPublicBucket : cosPrivateBucket;
  if (credentials.bucket !== expectedBucket || credentials.region !== cosRegion) throw new Error("COS 临时凭证与目标存储桶不匹配");
  const { client, getAuthorizationError } = await createClient(input.scope, credentials);
  let taskId = "";
  const abort = () => { if (taskId) client.cancelTask(taskId); };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await client.uploadFile({
      Bucket: credentials.bucket,
      Region: credentials.region,
      Key: path,
      Body: input.file,
      ContentType: input.contentType || input.file.type || "application/octet-stream",
      CacheControl: input.cacheControl || (input.scope.visibility === "public" ? "public, max-age=31536000, immutable" : "no-store"),
      SliceSize: 5 * 1024 * 1024,
      onTaskReady: (id) => { taskId = id; },
      onProgress: (progress) => input.onProgress?.({
        loaded: progress.loaded,
        total: progress.total || input.file.size,
        percent: Math.round(progress.percent * 100)
      })
    });
    const authorizationError = getAuthorizationError();
    if (authorizationError) throw authorizationError;
    return {
      provider: "tencent_cos",
      bucket: credentials.bucket,
      region: credentials.region,
      path,
      etag: String(result.ETag || "").replaceAll('"', ""),
      sizeBytes: input.file.size
    } satisfies CosStoredObject;
  } catch (error) {
    throw getAuthorizationError() || error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}
