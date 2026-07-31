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

export function mediaFigureHtml(media: ContentMedia) {
  const document = new DOMParser().parseFromString("<body></body>", "text/html");
  const figure = document.createElement("figure");
  figure.dataset.mediaId = media.id;
  figure.dataset.mediaKind = media.kind;
  if (media.kind === "video") {
    const video = document.createElement("video");
    video.controls = true;
    video.setAttribute("controlslist", "nodownload noremoteplayback");
    video.preload = "metadata";
    video.playsInline = true;
    figure.append(video);
  } else {
    figure.dataset.editorImage = "true";
    const image = document.createElement("img");
    image.alt = media.altText || media.title;
    image.loading = "lazy";
    image.decoding = "async";
    figure.append(image);
  }
  const caption = document.createElement("figcaption");
  caption.dataset.placeholder = media.kind === "video" ? "视频说明" : "图片说明";
  caption.textContent = media.note || media.title;
  figure.append(caption);
  return figure.outerHTML;
}

export function appendUnreferencedMediaHtml(html: string, media: ContentMedia[]) {
  const document = parseRichHtml(html);
  const referenced = new Set(Array.from(document.querySelectorAll<HTMLElement>("figure[data-media-id]")).map((figure) => figure.dataset.mediaId));
  for (const item of [...media].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (referenced.has(item.id)) continue;
    document.body.insertAdjacentHTML("beforeend", mediaFigureHtml(item));
    referenced.add(item.id);
  }
  return sanitizeHtml(document.body.innerHTML);
}

export function removeMediaFigureHtml(html: string, mediaId: string) {
  const document = parseRichHtml(html);
  document.querySelectorAll<HTMLElement>("figure[data-media-id]").forEach((figure) => {
    if (figure.dataset.mediaId === mediaId) figure.remove();
  });
  return sanitizeHtml(document.body.innerHTML);
}

export function hydrateMediaFigures(document: Document, media: ContentMedia[]) {
  const byId = new Map(media.map((item) => [item.id, item]));
  document.querySelectorAll<HTMLElement>("figure[data-media-id]").forEach((figure) => {
    const item = byId.get(figure.dataset.mediaId || "");
    if (!item) {
      if (figure.dataset.mediaKind === "video") figure.remove();
      return;
    }
    figure.id = `media-${item.id}`;
    figure.dataset.mediaKind = item.kind;
    if (item.kind === "image") {
      figure.dataset.editorImage = "true";
      let image = figure.querySelector<HTMLImageElement>(":scope > img");
      if (!image) {
        image = document.createElement("img");
        figure.prepend(image);
      }
      const variants = item.imageVariants || [];
      image.src = item.src;
      image.alt = item.altText || item.title;
      image.loading = "lazy";
      image.decoding = "async";
      if (item.width) image.width = item.width;
      if (item.height) image.height = item.height;
      if (variants.length) {
        image.srcset = variants.map((variant) => `${variant.src} ${variant.width}w`).join(", ");
        image.sizes = "(max-width: 720px) 100vw, min(100vw - 360px, 1120px)";
      }
      if (item.originalSrc) figure.dataset.originalSrc = item.originalSrc;
      return;
    }
    let video = figure.querySelector<HTMLVideoElement>(":scope > video");
    if (!video) {
      video = document.createElement("video");
      figure.prepend(video);
    }
    video.controls = true;
    video.setAttribute("controlslist", "nodownload noremoteplayback");
    video.preload = "metadata";
    video.playsInline = true;
    if (item.posterUrl) video.poster = item.posterUrl;
    else video.removeAttribute("poster");
    let source = video.querySelector<HTMLSourceElement>("source");
    if (!source) {
      source = document.createElement("source");
      video.append(source);
    }
    source.src = item.playbackUrl || item.src;
    source.type = item.mimeType || "video/mp4";
  });
  return document;
}
