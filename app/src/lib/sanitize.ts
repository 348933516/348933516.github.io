import DOMPurify from "dompurify";

const allowedProtocols = new Set(["https:"]);
const controlledAttributes: Record<string, Set<string>> = {
  "data-font-family": new Set(["default", "noto-sans", "noto-serif", "yahei", "pingfang", "simsun", "simhei", "kaiti", "fangsong", "arial", "georgia"]),
  "data-font-size": new Set(["12", "14", "16", "18", "20", "24", "28", "32", "36"]),
  "data-text-color": new Set(["default", "teal", "gold", "red", "blue", "green", "muted"]),
  "data-highlight": new Set(["teal", "gold", "red", "blue", "green"]),
  "data-table-border": new Set(["0", "1", "2", "3", "4"]),
  "data-table-style": new Set(["solid", "dashed", "dotted"]),
  "data-cell-background": new Set(["none", "teal", "gold", "red", "blue", "green", "surface"]),
  "data-cell-align": new Set(["left", "center", "right", "justify"])
};

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "style") {
    const alignment = data.attrValue.match(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i)?.[1]?.toLowerCase();
    if (alignment) data.attrValue = `text-align: ${alignment}`;
    else data.keepAttr = false;
    return;
  }
  const controlled = controlledAttributes[data.attrName];
  if (data.attrName.startsWith("data-")) {
    if (!controlled || !controlled.has(data.attrValue.toLowerCase())) data.keepAttr = false;
    return;
  }
  if (controlled) {
    if (!controlled.has(data.attrValue.toLowerCase())) data.keepAttr = false;
    return;
  }
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
      "img", "figure", "figcaption", "code", "pre", "hr", "span", "mark", "div"
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "src", "alt", "title", "colspan", "rowspan", "class", "style", "colwidth",
      "data-font-family", "data-font-size", "data-text-color", "data-highlight", "data-table-border", "data-table-style",
      "data-cell-background", "data-cell-align"
    ],
    ALLOW_DATA_ATTR: true
  });
}

export function slugify(value: string) {
  const latin = value.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || `content-${Date.now()}`;
}
