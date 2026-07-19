import DOMPurify from "dompurify";

const allowedProtocols = new Set(["https:"]);
const colorTokens = new Set(["teal", "gold", "red", "blue", "green", "muted", "surface", "none"]);
const safeHex = /^#[0-9a-f]{6}$/i;
const safeFontSize = /^(?:[8-9]|[1-6][0-9]|7[0-2])$/;
const controlledAttributes: Record<string, Set<string>> = {
  "data-font-family": new Set(["default", "noto-sans", "noto-serif", "yahei", "pingfang", "simsun", "simhei", "kaiti", "fangsong", "arial", "georgia"]),
  "data-table-border": new Set(["0", "1", "2", "3", "4"]),
  "data-table-style": new Set(["solid", "dashed", "dotted"]),
  "data-cell-align": new Set(["left", "center", "right", "justify"]),
  "data-editor-image": new Set(["true"]),
  "data-placeholder": new Set(["图片说明"])
};

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "style") {
    const safeDeclarations: string[] = [];
    for (const declaration of data.attrValue.split(";")) {
      const [rawName, ...rawValue] = declaration.split(":");
      const name = rawName?.trim().toLowerCase();
      const value = rawValue.join(":").trim().toLowerCase();
      if (name === "text-align" && /^(left|center|right|justify)$/.test(value)) safeDeclarations.push(`text-align: ${value}`);
      if (name === "color" && safeHex.test(value)) safeDeclarations.push(`color: ${value}`);
      if (name === "background-color" && safeHex.test(value)) safeDeclarations.push(`background-color: ${value}`);
      if (name === "font-size" && /^(\d{1,2})px$/.test(value) && safeFontSize.test(value.replace("px", ""))) safeDeclarations.push(`font-size: ${value}`);
      if (name === "border-color" && safeHex.test(value)) safeDeclarations.push(`border-color: ${value}`);
      if (name === "--rich-table-color" && safeHex.test(value)) safeDeclarations.push(`--rich-table-color: ${value}`);
      if (name === "--rich-table-border" && /^(?:0|1|2|3|4)px$/.test(value)) safeDeclarations.push(`--rich-table-border: ${value}`);
      if (name === "--rich-table-style" && /^(?:solid|dashed|dotted)$/.test(value)) safeDeclarations.push(`--rich-table-style: ${value}`);
    }
    if (safeDeclarations.length) data.attrValue = safeDeclarations.join("; ");
    else data.keepAttr = false;
    return;
  }
  if (data.attrName === "data-font-size") {
    if (!safeFontSize.test(data.attrValue)) data.keepAttr = false;
    return;
  }
   if (["data-text-color", "data-highlight", "data-table-color", "data-cell-background"].includes(data.attrName)) {
    const value = data.attrValue.toLowerCase();
    if (!safeHex.test(value) && !colorTokens.has(value)) data.keepAttr = false;
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
      "data-table-color", "data-cell-background", "data-cell-align", "data-editor-image"
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
