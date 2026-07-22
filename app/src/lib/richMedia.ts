import { sanitizeHtml } from "./sanitize";
import type { ContentMedia } from "../types";

function parseRichHtml(html: string) {
  return new DOMParser().parseFromString(sanitizeHtml(html), "text/html");
}

export function referencedMediaIds(html: string) {
  const document = parseRichHtml(html);
  return new Set(
    Array.from(document.querySelectorAll<HTMLElement>("figure[data-media-id]"))
      .map((figure) => figure.dataset.mediaId || "")
      .filter(Boolean)
  );
}

export function standaloneMedia(html: string, media: ContentMedia[]) {
  const referenced = referencedMediaIds(html);
  return media.filter((item) => !referenced.has(item.id));
}

export function normalizeInlineMediaDocument(html: string) {
  const document = parseRichHtml(html);
  const representedSources = new Set(
    Array.from(document.querySelectorAll<HTMLImageElement>("figure[data-media-id] > img[src]"))
      .map((image) => image.getAttribute("src") || "")
      .filter(Boolean)
  );

  document.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    if (image.closest("figure[data-media-id]")) return;
    if (representedSources.has(image.getAttribute("src") || "")) image.remove();
  });

  return document;
}

export function normalizeInlineMediaHtml(html: string) {
  return normalizeInlineMediaDocument(html).body.innerHTML;
}
