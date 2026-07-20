import { sanitizeHtml } from "./sanitize";

const fontMap: Array<[RegExp, string]> = [
  [/yahei|微软雅黑/i, "yahei"], [/pingfang|苹方/i, "pingfang"], [/simsun|宋体/i, "simsun"],
  [/simhei|黑体/i, "simhei"], [/kaiti|楷体/i, "kaiti"], [/fangsong|仿宋/i, "fangsong"],
  [/georgia|times/i, "georgia"], [/arial/i, "arial"]
];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function colorToHex(value: string) {
  const input = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(input)) return input;
  if (/^#[0-9a-f]{3}$/.test(input)) return `#${[...input.slice(1)].map((token) => token + token).join("")}`;
  const match = input.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return "";
  return `#${match.slice(1, 4).map((token) => Math.min(255, Number(token)).toString(16).padStart(2, "0")).join("")}`;
}

function fontToken(value: string) {
  return fontMap.find(([pattern]) => pattern.test(value))?.[1] || "";
}

function fontSizeToken(value: string) {
  const match = value.trim().match(/^([0-9.]+)(px|pt)?$/i);
  if (!match) return "";
  const pixels = match[2]?.toLowerCase() === "pt" ? Number(match[1]) * 4 / 3 : Number(match[1]);
  return String(Math.max(8, Math.min(72, Math.round(pixels))));
}

function renameElement(element: HTMLElement, tagName: string) {
  const replacement = element.ownerDocument.createElement(tagName);
  [...element.attributes].forEach((attribute) => replacement.setAttribute(attribute.name, attribute.value));
  while (element.firstChild) replacement.append(element.firstChild);
  element.replaceWith(replacement);
  return replacement;
}

function wrapChildren(element: HTMLElement, tagName: string) {
  const wrapper = element.ownerDocument.createElement(tagName);
  while (element.firstChild) wrapper.append(element.firstChild);
  element.append(wrapper);
}

export function normalizeOfficeClipboardHtml(value: string) {
  const document = new DOMParser().parseFromString(value, "text/html");
  document.querySelectorAll("script,style,meta,link,object,embed,iframe").forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>("b").forEach((element) => renameElement(element, "strong"));
  document.querySelectorAll<HTMLElement>("i").forEach((element) => renameElement(element, "em"));

  document.querySelectorAll<HTMLElement>("p,div,span,td,th").forEach((element) => {
    const style = element.style;
    const color = colorToHex(style.color);
    const background = colorToHex(style.backgroundColor || element.getAttribute("bgcolor") || "");
    const family = fontToken(style.fontFamily);
    const size = fontSizeToken(style.fontSize);
    const align = ["left", "center", "right", "justify"].includes(style.textAlign) ? style.textAlign : "";
    if (color) { element.setAttribute("data-text-color", color); element.style.color = color; }
    if (family) element.setAttribute("data-font-family", family);
    if (size) { element.setAttribute("data-font-size", size); element.style.fontSize = `${size}px`; }
    if (align) { element.setAttribute("data-cell-align", align); element.style.textAlign = align; }
    if (element.matches("td,th") && background) { element.setAttribute("data-cell-background", background); element.style.backgroundColor = background; }
    if (style.fontWeight === "bold" || Number(style.fontWeight) >= 600) wrapChildren(element, "strong");
    if (style.fontStyle === "italic") wrapChildren(element, "em");
    if ((style.textDecorationLine || "").includes("underline") || (style.textDecoration || "").includes("underline")) wrapChildren(element, "u");
  });

  document.querySelectorAll<HTMLElement>("table").forEach((table) => {
    const borderColor = colorToHex(table.style.borderColor) || "#2b3a40";
    table.setAttribute("data-table-border", "1");
    table.setAttribute("data-table-style", "solid");
    table.setAttribute("data-table-color", borderColor);
    table.querySelectorAll<HTMLElement>("td,th").forEach((cell) => {
      const cellColor = colorToHex(cell.style.borderColor) || borderColor;
      cell.setAttribute("data-cell-border-width", "1");
      cell.setAttribute("data-cell-border-style", "solid");
      cell.setAttribute("data-cell-border-color", cellColor);
      cell.style.borderWidth = "1px";
      cell.style.borderStyle = "solid";
      cell.style.borderColor = cellColor;
    });
  });

  document.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (!/^https:\/\//i.test(image.src)) image.remove();
  });
  return sanitizeHtml(document.body.innerHTML);
}

export function tabSeparatedTextToTableHtml(value: string) {
  const rows = value.replace(/\r\n?/g, "\n").split("\n").filter((row) => row.length > 0);
  if (rows.length < 2 || !rows.some((row) => row.includes("\t"))) return "";
  const columns = Math.max(...rows.map((row) => row.split("\t").length));
  if (columns < 2) return "";
  const body = rows.map((row, rowIndex) => {
    const cells = row.split("\t");
    while (cells.length < columns) cells.push("");
    const tag = rowIndex === 0 ? "th" : "td";
    return `<tr>${cells.map((cell) => `<${tag} data-cell-border-width="1" data-cell-border-style="solid" data-cell-border-color="#2b3a40">${escapeHtml(cell) || "<br>"}</${tag}>`).join("")}</tr>`;
  }).join("");
  return sanitizeHtml(`<table data-table-border="1" data-table-style="solid" data-table-color="#2b3a40"><tbody>${body}</tbody></table>`);
}
