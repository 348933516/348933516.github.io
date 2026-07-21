import { useMemo } from "react";
import { normalizeInlineMediaHtml } from "../lib/richMedia";

export function prepareRichHtml(value: string) {
  const document = new DOMParser().parseFromString(normalizeInlineMediaHtml(value), "text/html");
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
