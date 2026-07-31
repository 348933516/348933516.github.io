import { useEffect, useMemo, useRef } from "react";
import { hydrateMediaFigures, normalizeInlineMediaDocument } from "../lib/richMedia";
import { normalizeOutlineSettings, outlineLabel, outlineUuidPattern } from "../lib/outline";
import type { ContentMedia, OutlineSettings } from "../types";
import type { OutlineItem } from "./DocumentNavigation";

const blankImage = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

function outlineToken(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "section";
}

export function prepareRichDocument(value: string, media: ContentMedia[] = [], outlineSettings?: OutlineSettings) {
  const document = hydrateMediaFigures(normalizeInlineMediaDocument(value), media);
  const settings = normalizeOutlineSettings(outlineSettings);
  const byMediaId = new Map(media.map((item) => [item.id, item]));
  const headingCounts = new Map<string, number>();
  const outline: OutlineItem[] = [];

  document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, figure[data-media-id]").forEach((node) => {
    if (/^H[1-4]$/.test(node.tagName)) {
      const sourceLabel = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!sourceLabel) return;
      const token = outlineToken(sourceLabel);
      const occurrence = (headingCounts.get(token) || 0) + 1;
      headingCounts.set(token, occurrence);
      const stableId = node.getAttribute("data-outline-id") || "";
      const targetId = `section-${token}${occurrence > 1 ? `-${occurrence}` : ""}`;
      node.id = targetId;
      node.classList.add("rich-section-heading");
      const itemId = outlineUuidPattern.test(stableId) ? stableId.toLowerCase() : `outline-${targetId}`;
      outline.push({ id: itemId, label: outlineLabel(settings, itemId, sourceLabel), level: Number(node.tagName.slice(1)), kind: "heading", targetId });
      return;
    }

    const mediaId = node.dataset.mediaId || "";
    const item = byMediaId.get(mediaId);
    const stableId = node.getAttribute("data-outline-id") || "";
    const baseId = outlineUuidPattern.test(stableId) ? stableId.toLowerCase() : mediaId;
    const targetId = `media-${mediaId}`;
    node.id = targetId;
    const segments = item?.path.map((part) => part.trim()).filter(Boolean) || [];
    if (!segments.length) {
      const fallback = item?.title || node.querySelector("figcaption")?.textContent || (node.dataset.mediaKind === "video" ? "视频" : "图片");
      segments.push(fallback.trim() || "媒体");
    }
    segments.slice(0, 4).forEach((sourceLabel, index) => {
      const itemId = segments.length > 1 ? `${baseId}:path:${index}` : baseId;
      outline.push({ id: itemId, label: outlineLabel(settings, itemId, sourceLabel), level: Math.min(index + 1, 4), kind: "media", targetId });
    });
  });

  const referencedMediaIds = new Set(Array.from(document.querySelectorAll<HTMLElement>("figure[data-media-id]")).map((figure) => figure.dataset.mediaId || "").filter(Boolean));
  document.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("rich-table-scroll")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "rich-table-scroll";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
  document.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const source = image.getAttribute("src") || "";
    const sourceSet = image.getAttribute("srcset") || "";
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    if (source.startsWith("https://")) {
      image.dataset.readerSrc = source;
      image.src = blankImage;
    }
    if (sourceSet) {
      image.dataset.readerSrcset = sourceSet;
      image.removeAttribute("srcset");
    }
  });
  document.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
    video.controls = true;
    video.preload = "none";
    video.playsInline = true;
    video.setAttribute("controlslist", "nodownload noremoteplayback");
    const source = video.querySelector<HTMLSourceElement>("source[src]");
    if (source?.src) {
      source.dataset.readerSrc = source.getAttribute("src") || "";
      source.removeAttribute("src");
    }
  });
  document.querySelectorAll<HTMLElement>("figure[data-original-src]").forEach((figure) => {
    const image = figure.querySelector(":scope > img");
    const original = figure.getAttribute("data-original-src");
    if (!image || !original || image.parentElement?.tagName === "A") return;
    const link = document.createElement("a");
    link.href = original;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "查看原图";
    image.replaceWith(link);
    link.append(image);
  });
  return { html: document.body.innerHTML, referencedMediaIds, outline };
}

export function prepareRichHtml(value: string) {
  return prepareRichDocument(value).html;
}

export function RichContent({ html, media = [], className = "reader-body", prepared = false, outlineSettings }: { html: string; media?: ContentMedia[]; className?: string; prepared?: boolean; outlineSettings?: OutlineSettings }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rendered = useMemo(() => prepared ? html : prepareRichDocument(html, media, outlineSettings).html, [html, media, outlineSettings, prepared]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-reader-src]"));
    const videos = Array.from(root.querySelectorAll<HTMLVideoElement>("video"));
    let initialPhase = true;
    const activateImage = (image: HTMLImageElement) => {
      if (!image.dataset.readerSrc) return;
      image.src = image.dataset.readerSrc;
      if (image.dataset.readerSrcset) image.srcset = image.dataset.readerSrcset;
      delete image.dataset.readerSrc;
      delete image.dataset.readerSrcset;
    };
    const activateVideo = (video: HTMLVideoElement) => {
      const source = video.querySelector<HTMLSourceElement>("source[data-reader-src]");
      if (!source?.dataset.readerSrc) return;
      source.src = source.dataset.readerSrc;
      delete source.dataset.readerSrc;
      video.load();
    };
    images.slice(0, 3).forEach(activateImage);
    const entries = [...images, ...videos];
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((observed) => {
      observed.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (entry.target instanceof HTMLImageElement) {
          const index = images.indexOf(entry.target);
          if (initialPhase && index >= 3) return;
          activateImage(entry.target);
        } else if (entry.target instanceof HTMLVideoElement) activateVideo(entry.target);
      });
    }, { rootMargin: "500px 0px" });
    entries.forEach((entry) => observer?.observe(entry));
    if (!observer) {
      images.forEach(activateImage);
      videos.forEach(activateVideo);
    }
    const unlock = () => {
      initialPhase = false;
      images.forEach((image) => {
        const rect = image.getBoundingClientRect();
        if (rect.top < window.innerHeight + 500 && rect.bottom > -500) activateImage(image);
      });
    };
    const blockContextMenu = (event: Event) => event.preventDefault();
    const preparePlayback = (event: Event) => activateVideo(event.currentTarget as HTMLVideoElement);
    videos.forEach((video) => {
      video.addEventListener("contextmenu", blockContextMenu);
      video.addEventListener("pointerdown", preparePlayback, { once: true });
    });
    window.addEventListener("scroll", unlock, { passive: true, once: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", unlock);
      videos.forEach((video) => {
        video.removeEventListener("contextmenu", blockContextMenu);
        video.removeEventListener("pointerdown", preparePlayback);
      });
    };
  }, [rendered]);

  return <div ref={rootRef} className={className} dangerouslySetInnerHTML={{ __html: rendered }} />;
}
