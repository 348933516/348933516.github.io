import mammoth from "mammoth";

type StartMessage = { type: "start"; mode: "preview" | "extract"; buffer: ArrayBuffer };
type AckMessage = { type: "ack"; id: string };

const worker = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", handler: (event: MessageEvent<StartMessage | AckMessage>) => void): void;
};
const acknowledgements = new Map<string, () => void>();

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function extensionFor(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "bin";
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
        const original = await image.readAsArrayBuffer();
        const mimeType = image.contentType || "application/octet-stream";
        totalOriginalBytes += original.byteLength;
        const hash = hex(await crypto.subtle.digest("SHA-256", original));
        worker.postMessage({ type: "progress", phase: message.mode === "preview" ? "preview" : "encoding", current: imageCount, total: 0 });

        if (message.mode === "extract") {
          // The embedded PNG is already lossless. Re-encoding 98 large map
          // images in the browser is memory-intensive and was preventing the
          // upload phase from ever starting. Keep the original bytes instead.
          const acknowledgement = new Promise<void>((resolve) => acknowledgements.set(id, resolve));
          worker.postMessage({
            type: "asset",
            asset: {
              id,
              index: imageCount,
              hash,
              mimeType,
              extension: extensionFor(mimeType),
              original,
              width: 0,
              height: 0
            }
          }, [original]);
          await acknowledgement;
        }

        return { src: `https://word-import.invalid/${id}`, alt: `图片 ${imageCount}` };
      }),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"]
    }
  );
  worker.postMessage({ type: "complete", html: result.value, imageCount, totalOriginalBytes, warnings: result.messages.map((entry) => entry.message) });
}

worker.addEventListener("message", (event: MessageEvent<StartMessage | AckMessage>) => {
  if (event.data.type === "ack") {
    acknowledgements.get(event.data.id)?.();
    acknowledgements.delete(event.data.id);
    return;
  }
  void processDocument(event.data).catch((error) => worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Word 解析失败" }));
});
