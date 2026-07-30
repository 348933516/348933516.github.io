export const DEFAULT_FAVICON_URL = "./favicon.svg";

export function centeredSquareCrop(width: number, height: number) {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

export function syncSiteFavicon(url?: string | null) {
  const href = url || DEFAULT_FAVICON_URL;
  let link = document.querySelector<HTMLLinkElement>("#site-favicon");
  if (!link) {
    link = document.createElement("link");
    link.id = "site-favicon";
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = url ? "image/png" : "image/svg+xml";
  link.onerror = url ? () => {
    link!.onerror = null;
    link!.type = "image/svg+xml";
    link!.href = DEFAULT_FAVICON_URL;
  } : null;
  if (link.href !== new URL(href, document.baseURI).href) link.href = href;
}

export async function cropFaviconToPng(file: File, size = 32) {
  if (!file.type.startsWith("image/")) throw new Error("Favicon must be an image");
  const bitmap = await createImageBitmap(file);
  try {
    const crop = centeredSquareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.clearRect(0, 0, size, size);
    context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Favicon conversion failed")), "image/png");
    });
    return new File([blob], "favicon-32.png", { type: "image/png", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
