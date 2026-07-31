import { callTencentApi } from "./tencent-api.ts";
import { buildCosFederationPolicy, type CosFederationPolicyInput } from "./cos-policy.ts";
import { CosRequestError, parseCosErrorResponse } from "./cos-error.ts";

export { CosRequestError } from "./cos-error.ts";

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha1(value: string) {
  return hex(await crypto.subtle.digest("SHA-1", encoder.encode(value)));
}

async function hmacSha1(key: string, value: string) {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", imported, encoder.encode(value)));
}

function encodeKey(key: string) {
  return key.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function cosConfiguration() {
  const secretId = Deno.env.get("TENCENT_COS_SECRET_ID") || "";
  const secretKey = Deno.env.get("TENCENT_COS_SECRET_KEY") || "";
  const appId = Deno.env.get("TENCENT_COS_APP_ID") || "";
  const ownerUin = Deno.env.get("TENCENT_COS_UIN") || "";
  const region = Deno.env.get("TENCENT_COS_REGION") || "ap-guangzhou";
  const publicBucket = Deno.env.get("TENCENT_COS_PUBLIC_BUCKET") || "maplestorynk-media-1331200863";
  const privateBucket = Deno.env.get("TENCENT_COS_PRIVATE_BUCKET") || "maplestorynk-private-1331200863";
  const mediaBaseUrl = (Deno.env.get("TENCENT_MEDIA_BASE_URL") || "https://media.maplestorynk.online").replace(/\/$/, "");
  if (!secretId || !secretKey || !appId || !ownerUin) throw new Error("腾讯云 COS Secrets 尚未完整配置");
  return { secretId, secretKey, appId, ownerUin, region, publicBucket, privateBucket, mediaBaseUrl };
}

export async function getCosFederationToken(input: CosFederationPolicyInput & { name: string }) {
  const configuration = cosConfiguration();
  const response = await callTencentApi({
    service: "sts",
    host: "sts.tencentcloudapi.com",
    version: "2018-08-13",
    action: "GetFederationToken",
    secretId: configuration.secretId,
    secretKey: configuration.secretKey,
    region: configuration.region,
    payload: {
      Name: input.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32),
      DurationSeconds: 1800,
      Policy: JSON.stringify(buildCosFederationPolicy(input, {
        region: configuration.region,
        appId: configuration.appId
      }))
    }
  });
  const credentials = response.Credentials as Record<string, unknown> | undefined;
  if (!credentials?.TmpSecretId || !credentials?.TmpSecretKey || !credentials?.Token) throw new Error("腾讯云 STS 未返回完整临时凭证");
  return {
    tmpSecretId: String(credentials.TmpSecretId),
    tmpSecretKey: String(credentials.TmpSecretKey),
    sessionToken: String(credentials.Token),
    startTime: Math.floor(Date.now() / 1000) - 30,
    expiredTime: Number(response.ExpiredTime || 0),
    bucket: input.bucket,
    region: configuration.region,
    prefix: input.prefix,
    policyAppIdVerified: input.bucket.endsWith(`-${configuration.appId}`)
  };
}

async function cosAuthorization(method: string, bucket: string, key: string, extraHeaders: Record<string, string> = {}) {
  const configuration = cosConfiguration();
  const start = Math.floor(Date.now() / 1000) - 30;
  const keyTime = `${start};${start + 900}`;
  const host = `${bucket}.cos.${configuration.region}.myqcloud.com`;
  const headers: Record<string, string> = { host, ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value.trim()])) };
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(headers[name])}`).join("&");
  const path = `/${encodeKey(key)}`;
  const httpString = `${method.toLowerCase()}\n${path}\n\n${canonicalHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${await sha1(httpString)}\n`;
  const signKey = await hmacSha1(configuration.secretKey, keyTime);
  const signature = await hmacSha1(signKey, stringToSign);
  return {
    host,
    path,
    authorization: `q-sign-algorithm=sha1&q-ak=${configuration.secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerNames.join(";")}&q-url-param-list=&q-signature=${signature}`
  };
}

async function cosRequestOnce(input: { method: "HEAD" | "DELETE" | "PUT"; bucket: string; key: string; headers?: Record<string, string>; operation?: string }, signal: AbortSignal) {
  const configuration = cosConfiguration();
  const signed = await cosAuthorization(input.method, input.bucket, input.key, input.headers);
  const response = await fetch(`https://${signed.host}${signed.path}`, {
    method: input.method,
    headers: { Authorization: signed.authorization, ...(input.headers || {}) },
    signal
  });
  if (!response.ok && !(input.method === "DELETE" && response.status === 404)) {
    const detail = (await response.text()).slice(0, 2_000);
    const operation = input.operation || input.method;
    throw parseCosErrorResponse({
      detail,
      httpStatus: response.status,
      headerRequestId: response.headers.get("x-cos-request-id"),
      operation,
      bucket: input.bucket
    });
  }
  return response;
}

export async function cosRequest(input: { method: "HEAD" | "DELETE" | "PUT"; bucket: string; key: string; headers?: Record<string, string>; operation?: string }) {
  const timeoutMs = input.method === "PUT" ? 60_000 : input.method === "HEAD" ? 20_000 : 15_000;
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await cosRequestOnce(input, controller.signal);
    } catch (error) {
      lastError = error instanceof DOMException && error.name === "AbortError"
        ? new CosRequestError({ operation: input.operation || input.method, code: "COS_TIMEOUT", bucket: input.bucket, message: `COS ${input.operation || input.method} timed out after ${timeoutMs}ms` })
        : error;
      if (attempt === attempts) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`COS ${input.method} failed`);
}

export async function headCosObject(bucket: string, key: string, operation = "HeadObject") {
  const response = await cosRequest({ method: "HEAD", bucket, key, operation });
  return {
    etag: (response.headers.get("etag") || "").replaceAll('"', ""),
    sizeBytes: Number(response.headers.get("content-length") || 0),
    contentType: response.headers.get("content-type") || "application/octet-stream"
  };
}

export async function copyCosObject(sourceBucket: string, sourceKey: string, destinationBucket: string, destinationKey: string, options?: { cacheControl?: string; sourceContentType?: string; verifyDestination?: boolean }) {
  const sourceContentType = options?.sourceContentType || (await headCosObject(sourceBucket, sourceKey, "HeadSourceObject")).contentType;
  const copySource = `/${sourceBucket}/${encodeKey(sourceKey)}`;
  const metadataHeaders = options?.cacheControl
    ? { "x-cos-metadata-directive": "Replaced", "cache-control": options.cacheControl, "content-type": sourceContentType }
    : { "x-cos-metadata-directive": "Copy" };
  await cosRequest({
    method: "PUT",
    bucket: destinationBucket,
    key: destinationKey,
    operation: "CopyObject",
    headers: { "x-cos-copy-source": copySource, ...metadataHeaders }
  });
  if (options?.verifyDestination === false) {
    return { etag: "", sizeBytes: 0, contentType: sourceContentType };
  }
  return headCosObject(destinationBucket, destinationKey);
}

export async function deleteCosObject(bucket: string, key: string) {
  await cosRequest({ method: "DELETE", bucket, key, operation: "DeleteObject" });
}

export async function signedCosObjectUrl(bucket: string, key: string) {
  const signed = await cosAuthorization("GET", bucket, key);
  return `https://${signed.host}${signed.path}?${signed.authorization}`;
}

export async function signedCosUploadUrl(bucket: string, key: string, contentType: string, cacheControl: string) {
  const headers = { "content-type": contentType, "cache-control": cacheControl };
  const signed = await cosAuthorization("PUT", bucket, key, headers);
  return {
    url: `https://${signed.host}${signed.path}?${signed.authorization}`,
    headers
  };
}
