const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

export type ResumableUploadInput = {
  endpoint: string;
  accessToken: string;
  publishableKey: string;
  bucket: string;
  objectPath: string;
  contentType: string;
  data: ArrayBuffer;
  chunkSize?: number;
  fetchImpl?: typeof fetch;
};

function encodeMetadata(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function textOf(response: Response) {
  const text = await response.text();
  return text ? text.slice(0, 500) : `HTTP ${response.status}`;
}

async function retryRequest(fetchImpl: typeof fetch, url: string, init: RequestInit, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (response.ok || (response.status !== 408 && response.status !== 429 && response.status < 500)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("断点续传请求失败");
}

function offsetOf(response: Response) {
  const value = Number(response.headers.get("upload-offset"));
  if (!Number.isInteger(value) || value < 0) throw new Error("存储服务没有返回有效上传进度");
  return value;
}

export async function uploadResumableObject(input: ResumableUploadInput) {
  const fetchImpl = input.fetchImpl || fetch;
  const commonHeaders = {
    Authorization: `Bearer ${input.accessToken}`,
    apikey: input.publishableKey,
    "Tus-Resumable": "1.0.0"
  };
  const create = await retryRequest(fetchImpl, input.endpoint, {
    method: "POST",
    headers: {
      ...commonHeaders,
      "Upload-Length": String(input.data.byteLength),
      "Upload-Metadata": [
        `bucketName ${encodeMetadata(input.bucket)}`,
        `objectName ${encodeMetadata(input.objectPath)}`,
        `contentType ${encodeMetadata(input.contentType)}`,
        `cacheControl ${encodeMetadata("3600")}`
      ].join(","),
      "x-upsert": "false"
    }
  });
  if (!create.ok) throw new Error(`无法创建断点续传任务：${await textOf(create)}`);

  const location = create.headers.get("location");
  if (!location) throw new Error("存储服务没有返回断点续传地址");
  const uploadUrl = new URL(location, input.endpoint).toString();
  const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
  let offset = create.headers.get("upload-offset") ? offsetOf(create) : 0;

  const syncOffset = async () => {
    const response = await retryRequest(fetchImpl, uploadUrl, { method: "HEAD", headers: commonHeaders });
    if (!response.ok) throw new Error(`无法恢复断点续传进度：${await textOf(response)}`);
    return offsetOf(response);
  };

  while (offset < input.data.byteLength) {
    const nextOffset = Math.min(offset + chunkSize, input.data.byteLength);
    let response: Response;
    try {
      response = await retryRequest(fetchImpl, uploadUrl, {
        method: "PATCH",
        headers: {
          ...commonHeaders,
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset)
        },
        body: input.data.slice(offset, nextOffset)
      });
    } catch {
      offset = await syncOffset();
      continue;
    }
    if (!response.ok) {
      if (response.status === 409 || response.status === 412) {
        offset = await syncOffset();
        continue;
      }
      throw new Error(`断点续传图片失败：${await textOf(response)}`);
    }
    const reportedOffset = offsetOf(response);
    if (reportedOffset <= offset || reportedOffset > input.data.byteLength) {
      offset = await syncOffset();
      if (offset <= 0 || offset > input.data.byteLength) throw new Error("存储服务返回异常上传进度");
    } else {
      offset = reportedOffset;
    }
  }
}

