import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretId = process.env.TENCENT_COS_SECRET_ID || "";
const secretKey = process.env.TENCENT_COS_SECRET_KEY || "";
const region = process.env.TENCENT_COS_REGION || "ap-guangzhou";
const bucket = process.env.TENCENT_COS_PUBLIC_BUCKET || "maplestorynk-media-1331200863";
const version = "0.12.10-r2";
const cacheControl = "public, max-age=31536000, immutable";
const uploadTimeoutMs = 120_000;
const maxUploadAttempts = 2;
const wasmPartSize = 4 * 1024 * 1024;

if (!secretId || !secretKey) {
  throw new Error("Tencent COS credentials are required to deploy the browser video runtime");
}

const [coreJavaScript, coreWasm] = await Promise.all([
  readFile(path.join(repositoryRoot, "app/public/ffmpeg/ffmpeg-core.js")),
  readFile(path.join(repositoryRoot, "app/public/ffmpeg/ffmpeg-core.wasm"))
]);

const wasmParts = Array.from({ length: Math.ceil(coreWasm.byteLength / wasmPartSize) }, (_, index) => {
  const rawPart = coreWasm.subarray(index * wasmPartSize, Math.min(coreWasm.byteLength, (index + 1) * wasmPartSize));
  return {
    key: `site/runtime/ffmpeg/${version}/ffmpeg-core.wasm.part-${String(index + 1).padStart(2, "0")}`,
    body: gzipSync(rawPart, { level: 9 }),
    headers: {
      "cache-control": cacheControl,
      "content-encoding": "gzip",
      "content-type": "application/octet-stream"
    }
  };
});

const assets = [
  {
    key: `site/runtime/ffmpeg/${version}/ffmpeg-core.js`,
    body: coreJavaScript,
    headers: {
      "cache-control": cacheControl,
      "content-type": "text/javascript; charset=utf-8"
    }
  },
  ...wasmParts
];

for (const asset of assets) {
  await putObject(asset.key, asset.body, asset.headers);
  console.log(`Published ${asset.key} (${asset.body.byteLength} bytes)`);
}

async function putObject(key, body, headers) {
  await requestWithRetry("PUT", key, body, headers);
}

async function requestWithRetry(method, key, body, headers, query = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxUploadAttempts; attempt += 1) {
    try {
      return await requestObjectOnce(method, key, body, headers, query);
    } catch (error) {
      lastError = error;
      if (attempt < maxUploadAttempts) {
        console.warn(`COS runtime ${method} attempt ${attempt} failed; retrying ${key}`);
      }
    }
  }
  throw lastError;
}

function requestObjectOnce(method, key, body, headers, query = {}) {
  const signed = authorize(method, key, headers, query);
  return new Promise((resolve, reject) => {
    const request = https.request({
      method,
      hostname: signed.host,
      path: signed.path,
      headers: {
        Authorization: signed.authorization,
        ...headers,
        "content-length": String(body.byteLength)
      }
    }, (response) => {
      const responseChunks = [];
      response.on("data", (chunk) => responseChunks.push(chunk));
      response.on("end", () => {
        const responseBody = Buffer.concat(responseChunks).toString("utf8");
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ statusCode: response.statusCode, headers: response.headers, body: responseBody });
          return;
        }
        const requestId = response.headers["x-cos-request-id"] || "unavailable";
        reject(new Error(`COS runtime ${method} failed with HTTP ${response.statusCode || 0}, request ID ${requestId}: ${responseBody.slice(0, 500)}`));
      });
    });
    request.setTimeout(uploadTimeoutMs, () => {
      request.destroy(new Error(`COS runtime upload timed out after ${uploadTimeoutMs}ms`));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function authorize(method, key, extraHeaders, query = {}) {
  const start = Math.floor(Date.now() / 1000) - 30;
  const keyTime = `${start};${start + 900}`;
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const headers = { host, ...extraHeaders };
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(String(headers[name]).trim())}`)
    .join("&");
  const requestPath = `/${key.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  const queryEntries = Object.entries(query)
    .map(([name, value]) => ({ name, canonicalName: name.toLowerCase(), value: String(value) }))
    .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName));
  const canonicalQuery = queryEntries
    .map(({ canonicalName, value }) => `${encodeURIComponent(canonicalName)}=${encodeURIComponent(value)}`)
    .join("&");
  const requestQuery = queryEntries
    .map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  const queryNames = queryEntries.map(({ canonicalName }) => canonicalName).join(";");
  const httpString = `${method.toLowerCase()}\n${requestPath}\n${canonicalQuery}\n${canonicalHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signKey = hmacSha1(secretKey, keyTime);
  const signature = hmacSha1(signKey, stringToSign);
  return {
    host,
    path: requestQuery ? `${requestPath}?${requestQuery}` : requestPath,
    authorization: `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerNames.join(";")}&q-url-param-list=${queryNames}&q-signature=${signature}`
  };
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

function hmacSha1(key, value) {
  return createHmac("sha1", key).update(value).digest("hex");
}
