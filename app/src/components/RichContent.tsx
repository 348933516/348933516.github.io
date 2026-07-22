import { useMemo } from "react";
import { normalizeInlineMediaDocument } from "../lib/richMedia";
import type { OutlineItem } from "./DocumentNavigation";

function outlineToken(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "section";
}

export function prepareRichDocument(value: string) {
  const document = normalizeInlineMediaDocument(value);
  const headingCounts = new Map<string, number>();
  const outline: OutlineItem[] = [];
  document.querySelectorAll<HTMLElement>("h1, h2, h3, h4").forEach((heading) => {
    const label = (heading.textContent || "").replace(/\s+/g, " ").trim();
    if (!label) {
      heading.removeAttribute("id");
      return;
    }
    const token = outlineToken(label);
    const occurrence = (headingCounts.get(token) || 0) + 1;
    headingCounts.set(token, occurrence);
    const targetId = `section-${token}${occurrence > 1 ? `-${occurrence}` : ""}`;
    heading.id = targetId;
    heading.classList.add("rich-section-heading");
    outline.push({
      id: `outline-${targetId}`,
      label,
      level: Number(heading.tagName.slice(1)),
      kind: "heading",
      targetId
    });
  });
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
  return { html: document.body.innerHTML, referencedMediaIds, outline };
}

export function prepareRichHtml(value: string) {
  return prepareRichDocument(value).html;
}

export function RichContent({ html, className = "reader-body", prepared = false }: { html: string; className?: string; prepared?: boolean }) {
  const rendered = useMemo(() => prepared ? html : prepareRichHtml(html), [html, prepared]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: rendered }} />;
}
