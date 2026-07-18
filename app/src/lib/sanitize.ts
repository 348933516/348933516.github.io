import DOMPurify from "dompurify";

const allowedProtocols = new Set(["https:"]);

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (!["href", "src"].includes(data.attrName)) return;
  if (!/^(?:https:\/\/|#)/i.test(data.attrValue)) data.keepAttr = false;
});

export function safeUrl(value?: string | null) {
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  try {
    const url = new URL(value, window.location.origin);
    const localDevelopment = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (!allowedProtocols.has(url.protocol) && !localDevelopment) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function sanitizeHtml(value?: string | null) {
  return DOMPurify.sanitize(value || "", {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s", "blockquote", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td",
      "img", "figure", "figcaption", "code", "pre", "hr", "span"
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "title", "colspan", "rowspan", "class"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https:\/\/|#)/i
  });
}

export function slugify(value: string) {
  const latin = value.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || `content-${Date.now()}`;
}
