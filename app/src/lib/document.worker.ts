import mammoth from "mammoth";
import { documentImportResponseMessage } from "./documentImportResponse";

type UploadSession = {
  supabaseUrl: string;
  publishableKey: string;
  accessToken: string;
  bucket: string;
  importId: string;
  uploadPrefix: string;
  existingMediaCount: number;
  expectedImages: number;
};
type StartMessage = { type: "start"; mode: "preview" | "extract"; buffer: ArrayBuffer; upload?: UploadSession };

const worker = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", handler: (event: MessageEvent<StartMessage>) => void): void;
};

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function extensionFor(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "bin";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || (response.status !== 408 && response.status !== 429 && response.status < 500)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await wait(500 * (2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("网络请求失败");
}

async function uploadAndRegisterImage(original: ArrayBuffer, input: { id: string; index: number; hash: string; mimeType: string; extension: string }, upload: UploadSession) {
  const mediaId = crypto.randomUUID();
  const originalPath = `${upload.uploadPrefix}/${mediaId}-original.${input.extension}`;
  const asset = {
    mediaId,
    originalPath,
    displayPath: originalPath,
    hash: input.hash,
    mimeType: input.mimeType,
    width: 0,
    height: 0,
    originalSize: original.byteLength,
    displaySize: original.byteLength,
    sortOrder: (upload.existingMediaCount + input.index) * 10,
    title: `图片 ${input.index}`,
    altText: `图片 ${input.index}`
  };
  const objectPath = originalPath.split("/").map(encodeURIComponent).join("/");
  const stored = await requestWithRetry(`${upload.supabaseUrl}/storage/v1/object/${upload.bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${upload.accessToken}`,
      apikey: upload.publishableKey,
      "Content-Type": input.mimeType,
      "x-upsert": "false"
    },
    body: original
  });
  if (!stored.ok) {
    const message = await documentImportResponseMessage(stored);
    if (!/duplicate|already exists|resource exists/i.test(message)) throw new Error(`图片 ${input.index} 上传失败：${message}`);
  }

  let registered: Response;
  try {
    registered = await requestWithRetry(`${upload.supabaseUrl}/functions/v1/document-import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${upload.accessToken}`,
        apikey: upload.publishableKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "register", importId: upload.importId, asset })
    });
  } catch (error) {
    await fetch(`${upload.supabaseUrl}/storage/v1/object/${upload.bucket}/${objectPath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${upload.accessToken}`, apikey: upload.publishableKey }
    });
    throw error;
  }
  if (!registered.ok) {
    await fetch(`${upload.supabaseUrl}/storage/v1/object/${upload.bucket}/${objectPath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${upload.accessToken}`, apikey: upload.publishableKey }
    });
    throw new Error(`图片 ${input.index} 登记失败：${await documentImportResponseMessage(registered)}`);
  }
  return { id: input.id, mediaId, displayUrl: `${upload.supabaseUrl}/storage/v1/object/public/${upload.bucket}/${objectPath}` };
}

async function processDocument(message: StartMessage) {
  let imageCount = 0;
  let uploadedImageCount = 0;
  let totalOriginalBytes = 0;
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: message.buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          imageCount += 1;
          const id = `word-image-${imageCount}`;
          const original = await image.readAsArrayBuffer();
          const mimeType = image.contentType || "application/octet-stream";
          totalOriginalBytes += original.byteLength;
          const hash = hex(await crypto.subtle.digest("SHA-256", original));
          worker.postMessage({ type: "progress", phase: message.mode === "preview" ? "preview" : "encoding", current: imageCount, total: message.upload?.expectedImages || 0 });

          if (message.mode === "extract") {
            if (!message.upload) throw new Error("缺少 Word 图片上传会话。");
            worker.postMessage({ type: "progress", phase: "upload", current: imageCount, total: message.upload.expectedImages });
            const uploaded = await uploadAndRegisterImage(original, { id, index: imageCount, hash, mimeType, extension: extensionFor(mimeType) }, message.upload);
            uploadedImageCount += 1;
            worker.postMessage({ type: "asset", asset: uploaded });
            worker.postMessage({ type: "progress", phase: "registered", current: uploadedImageCount, total: message.upload.expectedImages });
          }

          return { src: `https://word-import.invalid/${id}`, alt: `图片 ${imageCount}` };
        }),
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"]
      }
    );
    worker.postMessage({ type: "complete", html: result.value, imageCount, totalOriginalBytes, warnings: result.messages.map((entry) => entry.message) });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Word 解析失败";
    throw new Error(`${messageText}（已登记 ${uploadedImageCount}/${message.upload?.expectedImages || imageCount} 张）`);
  }
}

worker.addEventListener("message", (event: MessageEvent<StartMessage>) => {
  void processDocument(event.data).catch((error) => worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Word 解析失败" }));
});
