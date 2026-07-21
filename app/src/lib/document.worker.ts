import mammoth from "mammoth";
import { toTransferableArrayBuffer } from "./documentWorkerBuffer";
import { sha256Hex } from "./hash";

type StartMessage = { type: "start"; mode: "preview" | "extract"; buffer: ArrayBuffer };
type AckMessage = { type: "ack"; id: string; error?: string };
type IncomingMessage = StartMessage | AckMessage;

const worker = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", handler: (event: MessageEvent<IncomingMessage>) => void): void;
};

type PendingAck = { resolve(): void; reject(error: Error): void };
const acknowledgements = new Map<string, PendingAck>();

function extensionFor(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "bin";
}

function waitForAck(id: string) {
  return new Promise<void>((resolve, reject) => acknowledgements.set(id, { resolve, reject }));
}

async function createDisplayVariants(original: ArrayBuffer, mimeType: string) {
  if (!mimeType.startsWith("image/") || mimeType === "image/gif") return [];
  const bitmap = await createImageBitmap(new Blob([original], { type: mimeType }));
  try {
    const variants = [];
    for (const maxSide of [960, 1600] as const) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建 Word 图片预览画布");
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
      variants.push({ key: String(maxSide), width, height, mimeType: "image/webp", data: await blob.arrayBuffer() });
    }
    return variants;
  } finally {
    bitmap.close();
  }
}

async function processDocument(message: StartMessage) {
  let imageCount = 0;
  let totalOriginalBytes = 0;
  let imageFailure: Error | null = null;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: message.buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          imageCount += 1;
          const id = `word-image-${imageCount}`;
          // Mammoth's browser implementation returns a Uint8Array despite the
          // readAsArrayBuffer name. Copy it into an exact ArrayBuffer first.
          const original = toTransferableArrayBuffer(await image.readAsArrayBuffer() as unknown as ArrayBuffer | ArrayBufferView);
          const mimeType = image.contentType || "application/octet-stream";
          totalOriginalBytes += original.byteLength;

          if (message.mode === "extract") {
            const hash = sha256Hex(original);
            const variants = await createDisplayVariants(original, mimeType);
            const width = variants.at(-1)?.width || 0;
            const height = variants.at(-1)?.height || 0;
            worker.postMessage(
              { type: "image", image: { id, index: imageCount, hash, mimeType, extension: extensionFor(mimeType), original, width, height, variants } },
              [original, ...variants.map((variant) => variant.data)]
            );
            await waitForAck(id);
          } else {
            worker.postMessage({ type: "progress", phase: "preview", current: imageCount });
          }
          return { src: `https://word-import.invalid/${id}`, alt: `图片 ${imageCount}` };
        } catch (error) {
          imageFailure = error instanceof Error ? error : new Error("Word 图片处理失败");
          throw imageFailure;
        }
      }),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"]
    }
  );
  if (imageFailure) throw imageFailure;
  worker.postMessage({ type: "complete", html: result.value, imageCount, totalOriginalBytes, warnings: result.messages.map((entry) => entry.message) });
}

worker.addEventListener("message", (event) => {
  if (event.data.type === "ack") {
    const pending = acknowledgements.get(event.data.id);
    if (!pending) return;
    acknowledgements.delete(event.data.id);
    if (event.data.error) pending.reject(new Error(event.data.error));
    else pending.resolve();
    return;
  }
  void processDocument(event.data).catch((error) => worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Word 解析失败" }));
});
