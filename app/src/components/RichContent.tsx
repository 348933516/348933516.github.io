import { useMemo } from "react";
import { sanitizeHtml } from "../lib/sanitize";
import type { ContentMedia } from "../types";

export function referencedMediaIds(html: string) {
  const document = new DOMParser().parseFromString(sanitizeHtml(html), "text/html");
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

export function prepareRichHtml(value: string) {
  const document = new DOMParser().parseFromString(sanitizeHtml(value), "text/html");
  document.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("rich-table-scroll")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "rich-table-scroll";
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
  document.querySelectorAll("img").forEach((image) => {
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
  });
  return document.body.innerHTML;
}

export function RichContent({ html, className = "reader-body" }: { html: string; className?: string }) {
  const prepared = useMemo(() => prepareRichHtml(html), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: prepared }} />;
}
