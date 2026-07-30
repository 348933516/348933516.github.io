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

export interface CosUploadErrorDetails {
  operation: string;
  httpStatus: number | null;
  cosRequestId: string | null;
  bucket: string;
  stage: "credentials" | "upload" | "multipart" | "complete";
  retryCount: number;
  code: string;
  policyAppIdVerified: boolean;
}

export class CosUploadError extends Error {
  readonly details: CosUploadErrorDetails;

  constructor(message: string, details: CosUploadErrorDetails) {
    super(message);
    this.name = "CosUploadError";
    this.details = details;
  }
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
  policyAppIdVerified?: boolean;
};

const credentialCache = new Map<string, TemporaryCredentials>();

function scopeKey(scope: CosUploadScope) {
  return [scope.purpose, scope.contentId || "", scope.importId || "", scope.visibility, scope.prefix].join(":");
}

export function clearCosCredentialCache(scope?: CosUploadScope) {
  if (scope) credentialCache.delete(scopeKey(scope));
  else credentialCache.clear();
}

function validateObjectPath(path: string, prefix: string) {
  const normalized = path.replace(/^\/+/, "");
  const normalizedPrefix = prefix.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || !normalized.startsWith(normalizedPrefix)) {
    throw new Error("COS object path is outside the authorized prefix");
  }
  return normalized;
}

function readErrorField(error: unknown, keys: string[]) {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return String(record[key]);
  }
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
  if (nested) {
    for (const key of keys) {
      if (nested[key] !== undefined && nested[key] !== null) return String(nested[key]);
    }
  }
  const headers = record.headers && typeof record.headers === "object" ? record.headers as Record<string, unknown> : null;
  if (headers) {
    for (const key of keys) {
      if (headers[key] !== undefined && headers[key] !== null) return String(headers[key]);
    }
  }
  return "";
}

export function isCosAuthorizationFailure(error: unknown) {
  const status = Number(readErrorField(error, ["statusCode", "status", "httpStatus"]));
  const code = readErrorField(error, ["Code", "code", "errorCode"]);
  const message = error instanceof Error ? error.message : String(error || "");
  return status === 401 || status === 403 || /accessdenied|unauthorized|authfailure|invalidaccesskey|signature/i.test(`${code} ${message}`);
}

export function toCosUploadError(error: unknown, input: {
  bucket: string;
  stage: CosUploadErrorDetails["stage"];
  retryCount: number;
  operation?: string;
  policyAppIdVerified?: boolean;
}) {
  if (error instanceof CosUploadError) return error;
  const statusValue = Number(readErrorField(error, ["statusCode", "status", "httpStatus"]));
  const httpStatus = Number.isFinite(statusValue) && statusValue > 0 ? statusValue : null;
  const code = readErrorField(error, ["Code", "code", "errorCode"]) || (isCosAuthorizationFailure(error) ? "AccessDenied" : "COS_UPLOAD_FAILED");
  const cosRequestId = readErrorField(error, ["RequestId", "requestId", "x-cos-request-id"]) || null;
  const errorNode = readErrorField(error, ["errorNode"]);
  const operationByNode: Record<string, string> = {
    multipartList: "ListMultipartUploads",
    multipartInit: "InitiateMultipartUpload",
    multipartListPart: "ListParts",
    multipartUpload: "UploadPart",
    multipartComplete: "CompleteMultipartUpload"
  };
  const operation = readErrorField(error, ["operation", "Operation", "action"])
    || operationByNode[errorNode]
    || input.operation
    || (input.stage === "multipart" ? "multipart-upload" : input.stage === "complete" ? "CompleteMultipartUpload" : "PutObject");
  const rawMessage = error instanceof Error ? error.message : String(error || "COS upload failed");
  const nextStep = isCosAuthorizationFailure(error)
    ? "请检查私有桶 CAM 权限及 STS 分片上传动作后重试。"
    : "请保留 request ID 并重试；持续失败时在运行日志中查看该请求。";
  const message = `COS 上传失败：阶段 ${input.stage}，操作 ${operation}，错误 ${code}${httpStatus ? `，HTTP ${httpStatus}` : ""}${cosRequestId ? `，request ID ${cosRequestId}` : ""}。${nextStep} ${rawMessage.slice(0, 300)}`;
  return new CosUploadError(message, {
    operation,
    httpStatus,
    cosRequestId,
    bucket: input.bucket,
    stage: input.stage,
    retryCount: input.retryCount,
    code,
    policyAppIdVerified: input.policyAppIdVerified === true
  });
}

async function credentialsFor(scope: CosUploadScope) {
  if (!cosStorageEnabled) throw new Error("COS storage is disabled");
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
        authorizationError = error;
        callback(sdkCredentials(lastCredentials));
      }
    }
  });
  return {
    client,
    getAuthorizationError: () => authorizationError
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
}

async function uploadMultipart(input: {
  client: COS;
  bucket: string;
  region: string;
  path: string;
  file: Blob;
  contentType: string;
  cacheControl: string;
  signal?: AbortSignal;
  onProgress?(progress: UploadProgress): void;
  setOperation(operation: string): void;
}) {
  const chunkSize = 5 * 1024 * 1024;
  let uploadId = "";
  let currentOperation = "InitiateMultipartUpload";
  const setOperation = (operation: string) => {
    currentOperation = operation;
    input.setOperation(operation);
  };
  try {
    throwIfAborted(input.signal);
    setOperation("InitiateMultipartUpload");
    const initialized = await input.client.multipartInit({
      Bucket: input.bucket,
      Region: input.region,
      Key: input.path,
      ContentType: input.contentType,
      CacheControl: input.cacheControl
    });
    uploadId = initialized.UploadId;
    const parts: COS.Part[] = [];
    for (let offset = 0, partNumber = 1; offset < input.file.size; offset += chunkSize, partNumber += 1) {
      throwIfAborted(input.signal);
      setOperation("UploadPart");
      const body = input.file.slice(offset, Math.min(offset + chunkSize, input.file.size));
      const uploaded = await input.client.multipartUpload({
        Bucket: input.bucket,
        Region: input.region,
        Key: input.path,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: body.size
      });
      parts.push({ PartNumber: partNumber, ETag: uploaded.ETag });
      const loaded = Math.min(offset + body.size, input.file.size);
      input.onProgress?.({
        loaded,
        total: input.file.size,
        percent: Math.round((loaded / input.file.size) * 100)
      });
    }
    throwIfAborted(input.signal);
    setOperation("CompleteMultipartUpload");
    return await input.client.multipartComplete({
      Bucket: input.bucket,
      Region: input.region,
      Key: input.path,
      UploadId: uploadId,
      Parts: parts
    });
  } catch (error) {
    const failedOperation = currentOperation;
    if (uploadId) {
      try {
        setOperation("AbortMultipartUpload");
        await input.client.multipartAbort({
          Bucket: input.bucket,
          Region: input.region,
          Key: input.path,
          UploadId: uploadId
        });
      } catch {
        // Preserve the original upload failure; incomplete uploads can be cleaned separately.
      }
    }
    input.setOperation(failedOperation);
    throw error;
  }
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
  let retryCount = 0;
  for (;;) {
    const credentials = await credentialsFor(input.scope);
    const path = validateObjectPath(input.path, credentials.prefix);
    const expectedBucket = input.scope.visibility === "public" ? cosPublicBucket : cosPrivateBucket;
    if (credentials.bucket !== expectedBucket || credentials.region !== cosRegion) {
      throw new CosUploadError("COS credentials target does not match the requested bucket", {
        operation: "credentials",
        httpStatus: null,
        cosRequestId: null,
        bucket: credentials.bucket,
        stage: "credentials",
        retryCount,
        code: "COS_TARGET_MISMATCH",
        policyAppIdVerified: credentials.policyAppIdVerified === true
      });
    }
    const { client, getAuthorizationError } = await createClient(input.scope, credentials);
    let taskId = "";
    let operation = input.file.size > 5 * 1024 * 1024 ? "InitiateMultipartUpload" : "PutObject";
    const abort = () => { if (taskId) client.cancelTask(taskId); };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const contentType = input.contentType || input.file.type || "application/octet-stream";
      const cacheControl = input.cacheControl || (input.scope.visibility === "public" ? "public, max-age=31536000, immutable" : "no-store");
      const result = input.file.size > 5 * 1024 * 1024
        ? await uploadMultipart({
          client,
          bucket: credentials.bucket,
          region: credentials.region,
          path,
          file: input.file,
          contentType,
          cacheControl,
          signal: input.signal,
          onProgress: input.onProgress,
          setOperation: (value) => { operation = value; }
        })
        : await client.uploadFile({
          Bucket: credentials.bucket,
          Region: credentials.region,
          Key: path,
          Body: input.file,
          ContentType: contentType,
          CacheControl: cacheControl,
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
        etag: String(result.ETag || "").replaceAll('\"', ""),
        sizeBytes: input.file.size
      } satisfies CosStoredObject;
    } catch (error) {
      const actualError = getAuthorizationError() || error;
      if (retryCount === 0 && isCosAuthorizationFailure(actualError)) {
        retryCount = 1;
        clearCosCredentialCache(input.scope);
        continue;
      }
      const stage = input.file.size > 5 * 1024 * 1024 ? "multipart" : "upload";
      throw toCosUploadError(actualError, {
        bucket: credentials.bucket,
        stage,
        retryCount,
        operation,
        policyAppIdVerified: credentials.policyAppIdVerified
      });
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
  }
}
