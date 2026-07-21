import mammoth from "mammoth";
import { toTransferableArrayBuffer } from "./documentWorkerBuffer";

type StartMessage = { type: "start"; mode: "preview" | "extract"; buffer: ArrayBuffer };
type AckMessage = { type: "ack"; id: string; error?: string };
type IncomingMessage = StartMessage | AckMessage;

const worker = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", handler: (event: MessageEvent<IncomingMessage>) => void): void;
};

type PendingAck = { resolve(): void; reject(error: Error): void };
const acknowledgements = new Map<string, PendingAck>();

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function extensionFor(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "bin";
}

function waitForAck(id: string) {
  return new Promise<void>((resolve, reject) => acknowledgements.set(id, { resolve, reject }));
}

async function processDocument(message: StartMessage) {
  let imageCount = 0;
  let totalOriginalBytes = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: message.buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        imageCount += 1;
        const id = `word-image-${imageCount}`;
        // Mammoth's browser implementation returns a Uint8Array despite the
        // readAsArrayBuffer name. Transfer lists only accept its ArrayBuffer.
        const original = toTransferableArrayBuffer(await image.readAsArrayBuffer() as unknown as ArrayBuffer | ArrayBufferView);
        const mimeType = image.contentType || "application/octet-stream";
        totalOriginalBytes += original.byteLength;
        const hash = hex(await crypto.subtle.digest("SHA-256", original));

        if (message.mode === "extract") {
          worker.postMessage({ type: "image", image: { id, index: imageCount, hash, mimeType, extension: extensionFor(mimeType), original } }, [original]);
          await waitForAck(id);
        } else {
          worker.postMessage({ type: "progress", phase: "preview", current: imageCount });
        }
        return { src: `https://word-import.invalid/${id}`, alt: `图片 ${imageCount}` };
      }),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"]
    }
  );
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
