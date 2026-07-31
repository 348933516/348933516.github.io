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
const version = "0.12.10-r1";
const cacheControl = "public, max-age=31536000, immutable";
const uploadTimeoutMs = 120_000;
const maxUploadAttempts = 2;

if (!secretId || !secretKey) {
  throw new Error("Tencent COS credentials are required to deploy the browser video runtime");
}

const [coreJavaScript, coreWasm] = await Promise.all([
  readFile(path.join(repositoryRoot, "app/public/ffmpeg/ffmpeg-core.js")),
  readFile(path.join(repositoryRoot, "app/public/ffmpeg/ffmpeg-core.wasm"))
]);

const assets = [
  {
    key: `site/runtime/ffmpeg/${version}/ffmpeg-core.js`,
    body: coreJavaScript,
    headers: {
      "cache-control": cacheControl,
      "content-type": "text/javascript; charset=utf-8"
    }
  },
  {
    key: `site/runtime/ffmpeg/${version}/ffmpeg-core.wasm`,
    body: gzipSync(coreWasm, { level: 9 }),
    headers: {
      "cache-control": cacheControl,
      "content-encoding": "gzip",
      "content-type": "application/wasm"
    }
  }
];

for (const asset of assets) {
  await putObject(asset.key, asset.body, asset.headers);
  console.log(`Published ${asset.key} (${asset.body.byteLength} bytes)`);
}

async function putObject(key, body, headers) {
  let lastError;
  for (let attempt = 1; attempt <= maxUploadAttempts; attempt += 1) {
    try {
      await putObjectOnce(key, body, headers);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxUploadAttempts) {
        console.warn(`COS runtime upload attempt ${attempt} failed; retrying ${key}`);
      }
    }
  }
  throw lastError;
}

function putObjectOnce(key, body, headers) {
  const signed = authorize("PUT", key, headers);
  return new Promise((resolve, reject) => {
    const request = https.request({
      method: "PUT",
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
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        const requestId = response.headers["x-cos-request-id"] || "unavailable";
        const responseBody = Buffer.concat(responseChunks).toString("utf8").slice(0, 500);
        reject(new Error(`COS runtime upload failed with HTTP ${response.statusCode || 0}, request ID ${requestId}: ${responseBody}`));
      });
    });
    request.setTimeout(uploadTimeoutMs, () => {
      request.destroy(new Error(`COS runtime upload timed out after ${uploadTimeoutMs}ms`));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function authorize(method, key, extraHeaders) {
  const start = Math.floor(Date.now() / 1000) - 30;
  const keyTime = `${start};${start + 900}`;
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const headers = { host, ...extraHeaders };
  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(String(headers[name]).trim())}`)
    .join("&");
  const requestPath = `/${key.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  const httpString = `${method.toLowerCase()}\n${requestPath}\n\n${canonicalHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signKey = hmacSha1(secretKey, keyTime);
  const signature = hmacSha1(signKey, stringToSign);
  return {
    host,
    path: requestPath,
    authorization: `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerNames.join(";")}&q-url-param-list=&q-signature=${signature}`
  };
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

function hmacSha1(key, value) {
  return createHmac("sha1", key).update(value).digest("hex");
}
