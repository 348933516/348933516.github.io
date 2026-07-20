import DOMPurify from "dompurify";

const allowedProtocols = new Set(["https:"]);
const colorTokens = new Set(["teal", "gold", "red", "blue", "green", "muted", "surface", "none"]);
const safeHex = /^#[0-9a-f]{6}$/i;
const safeFontSize = /^(?:[8-9]|[1-6][0-9]|7[0-2])$/;
const controlledAttributes: Record<string, Set<string>> = {
  "data-font-family": new Set(["default", "noto-sans", "noto-serif", "yahei", "pingfang", "simsun", "simhei", "kaiti", "fangsong", "arial", "georgia"]),
  "data-table-border": new Set(["0", "0.5", "1", "1.5", "2", "3", "4", "5", "6", "8", "10", "12"]),
  "data-table-style": new Set(["solid", "dashed", "dotted", "double", "groove", "ridge", "none"]),
  "data-cell-border-width": new Set(["0", "0.5", "1", "1.5", "2", "3", "4", "5", "6", "8", "10", "12"]),
  "data-cell-border-style": new Set(["solid", "dashed", "dotted", "double", "groove", "ridge", "none"]),
  "data-cell-align": new Set(["left", "center", "right", "justify"]),
  "data-editor-image": new Set(["true"]),
  "data-office-image-placeholder": new Set(Array.from({ length: 100 }, (_, index) => String(index + 1))),
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
      if (name === "border-width" && /^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/.test(value)) safeDeclarations.push(`border-width: ${value}`);
      if (name === "border-style" && /^(?:solid|dashed|dotted|double|groove|ridge|none)$/.test(value)) safeDeclarations.push(`border-style: ${value}`);
      if (name === "--rich-table-color" && safeHex.test(value)) safeDeclarations.push(`--rich-table-color: ${value}`);
      if (name === "--rich-table-border" && /^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/.test(value)) safeDeclarations.push(`--rich-table-border: ${value}`);
      if (name === "--rich-table-style" && /^(?:solid|dashed|dotted|double|groove|ridge|none)$/.test(value)) safeDeclarations.push(`--rich-table-style: ${value}`);
      if (name === "--rich-cell-border-color" && safeHex.test(value)) safeDeclarations.push(`--rich-cell-border-color: ${value}`);
      if (name === "--rich-cell-border-width" && /^(?:0|0\.5|1|1\.5|2|3|4|5|6|8|10|12)px$/.test(value)) safeDeclarations.push(`--rich-cell-border-width: ${value}`);
      if (name === "--rich-cell-border-style" && /^(?:solid|dashed|dotted|double|groove|ridge|none)$/.test(value)) safeDeclarations.push(`--rich-cell-border-style: ${value}`);
    }
    if (safeDeclarations.length) data.attrValue = safeDeclarations.join("; ");
    else data.keepAttr = false;
    return;
  }
  if (data.attrName === "data-font-size") {
    if (!safeFontSize.test(data.attrValue)) data.keepAttr = false;
    return;
  }
  if (data.attrName === "data-media-id") {
    if (!/^[0-9a-f-]{36}$/i.test(data.attrValue)) data.keepAttr = false;
    return;
  }
   if (["data-text-color", "data-highlight", "data-table-color", "data-cell-background", "data-cell-border-color"].includes(data.attrName)) {
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
      "data-table-color", "data-cell-background", "data-cell-align", "data-cell-border-width", "data-cell-border-style", "data-cell-border-color", "data-editor-image", "data-media-id", "data-office-image-placeholder"
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
