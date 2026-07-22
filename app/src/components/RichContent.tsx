import { useMemo } from "react";
import { normalizeInlineMediaDocument } from "../lib/richMedia";

export function prepareRichDocument(value: string) {
  const document = normalizeInlineMediaDocument(value);
  const referencedMediaIds = new Set(
    Array.from(document.querySelectorAll<HTMLElement>("figure[data-media-id]"))
      .map((figure) => figure.dataset.mediaId || "")
      .filter(Boolean)
  );
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
  return { html: document.body.innerHTML, referencedMediaIds };
}

export function prepareRichHtml(value: string) {
  return prepareRichDocument(value).html;
}

export function RichContent({ html, className = "reader-body", prepared = false }: { html: string; className?: string; prepared?: boolean }) {
  const rendered = useMemo(() => prepared ? html : prepareRichHtml(html), [html, prepared]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: rendered }} />;
}
