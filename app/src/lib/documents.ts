import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { sanitizeHtml } from "./sanitize";
import { supabase } from "./supabase";

export interface WorksheetPreview {
  name: string;
  rowCount: number;
  columnCount: number;
  bodyHtml: string;
  bodyText: string;
}

export interface ImportPreview {
  kind: "document" | "workbook" | "web";
  title: string;
  bodyHtml: string;
  bodyText: string;
  images: string[];
  source: string;
  warning?: string;
  worksheets?: WorksheetPreview[];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function textToHtml(value: string) {
  return value.split(/\n{2,}/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

export function composeWorksheetImport(worksheets: WorksheetPreview[], selectedNames: string[]) {
  const selected = worksheets.filter((sheet) => selectedNames.includes(sheet.name));
  return {
    bodyHtml: sanitizeHtml(selected.map((sheet) => `<h2>${escapeHtml(sheet.name)}</h2>${sheet.bodyHtml}`).join("")),
    bodyText: selected.map((sheet) => `${sheet.name}\n${sheet.bodyText}`).join("\n\n")
  };
}

export async function readDocument(file: File): Promise<ImportPreview> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xls")) throw new Error("暂不支持旧版 .xls，请在 Excel 中另存为 .xlsx 后导入");
  if (lowerName.endsWith(".xlsx")) return readWorkbook(file);
  if (lowerName.endsWith(".docx")) {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      {
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"]
      }
    );
    const bodyHtml = sanitizeHtml(result.value);
    return {
      kind: "document",
      title: file.name.replace(/\.[^.]+$/, ""),
      bodyHtml,
      bodyText: new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent || "",
      images: [],
      source: file.name,
      warning: "Word 常用文字、标题、列表和表格已转换。分页、浮动对象和复杂版式请通过保留的原文件核对。"
    };
  }
  const bodyText = await file.text();
  const bodyHtml = lowerName.endsWith(".html") ? sanitizeHtml(bodyText) : sanitizeHtml(textToHtml(bodyText));
  return { kind: "document", title: file.name.replace(/\.[^.]+$/, ""), bodyHtml, bodyText: new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent || bodyText, images: [], source: file.name };
}

async function readWorkbook(file: File): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheets: WorksheetPreview[] = [];
  workbook.eachSheet((worksheet) => {
    const rowCount = Math.max(worksheet.actualRowCount, 1);
    const columnCount = Math.max(worksheet.actualColumnCount, 1);
    const mergeMap = new Map<string, { startRow: number; startColumn: number; endRow: number; endColumn: number }>();
    for (let row = 1; row <= rowCount; row += 1) for (let column = 1; column <= columnCount; column += 1) {
      const cell = worksheet.getCell(row, column);
      if (!cell.isMerged) continue;
      const key = cell.master.address;
      const current = mergeMap.get(key) || { startRow: row, startColumn: column, endRow: row, endColumn: column };
      current.startRow = Math.min(current.startRow, row); current.startColumn = Math.min(current.startColumn, column);
      current.endRow = Math.max(current.endRow, row); current.endColumn = Math.max(current.endColumn, column);
      mergeMap.set(key, current);
    }
    const merges = [...mergeMap.values()];
    let borderWidth = 1;
    let borderStyle = "solid";
    const rows: string[] = [];
    const plainRows: string[] = [];
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      const cells: string[] = [];
      const plainCells: string[] = [];
      for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
        const merge = merges.find((range) => rowNumber >= range.startRow && rowNumber <= range.endRow && columnNumber >= range.startColumn && columnNumber <= range.endColumn);
        if (merge && (rowNumber !== merge.startRow || columnNumber !== merge.startColumn)) continue;
        const cell = worksheet.getCell(rowNumber, columnNumber);
        const border = strongestBorder(cell.border);
        borderWidth = Math.max(borderWidth, border.width);
        if (border.style !== "solid") borderStyle = border.style;
        const colspan = merge ? merge.endColumn - merge.startColumn + 1 : 1;
        const rowspan = merge ? merge.endRow - merge.startRow + 1 : 1;
        const width = Math.max(60, Math.min(360, Math.round((worksheet.getColumn(columnNumber).width || 12) * 7)));
        const background = colorToken(cell.fill && "fgColor" in cell.fill ? cell.fill.fgColor?.argb : undefined);
        const alignment = ["center", "right", "justify"].includes(String(cell.alignment?.horizontal)) ? String(cell.alignment?.horizontal) : "left";
        const tag = rowNumber === 1 ? "th" : "td";
        const attributes = [
          colspan > 1 ? ` colspan="${colspan}"` : "",
          rowspan > 1 ? ` rowspan="${rowspan}"` : "",
          ` colwidth="${Array(colspan).fill(width).join(",")}"`,
          ` data-cell-background="${background || "none"}"`,
          ` data-cell-align="${alignment}"`
        ].join("");
        cells.push(`<${tag}${attributes}>${formatCell(cell)}</${tag}>`);
        plainCells.push(cell.text || "");
      }
      rows.push(`<tr>${cells.join("")}</tr>`);
      plainRows.push(plainCells.join("\t"));
    }
    const bodyHtml = sanitizeHtml(`<table data-table-border="${Math.min(4, borderWidth)}" data-table-style="${borderStyle}"><tbody>${rows.join("")}</tbody></table>`);
    worksheets.push({ name: worksheet.name, rowCount, columnCount, bodyHtml, bodyText: plainRows.join("\n") });
  });
  if (!worksheets.length) throw new Error("Excel 文件中没有可导入的工作表");
  const composed = composeWorksheetImport(worksheets, [worksheets[0].name]);
  return {
    kind: "workbook",
    title: file.name.replace(/\.[^.]+$/, ""),
    ...composed,
    images: [],
    source: file.name,
    worksheets,
    warning: "已读取 Excel。请选择要导入的工作表；公式使用文件中保存的显示结果，宏不会执行。"
  };
}

function formatCell(cell: { text: string; value: unknown; font?: { name?: string; size?: number; bold?: boolean; italic?: boolean; underline?: unknown; color?: { argb?: string } } }) {
  const richText = cell.value && typeof cell.value === "object" && "richText" in cell.value ? (cell.value as { richText: Array<{ text: string; font?: typeof cell.font }> }).richText : null;
  if (richText) return richText.map((part) => formatRun(part.text, part.font)).join("");
  return formatRun(cell.text || "", cell.font);
}

function formatRun(value: string, font?: { name?: string; size?: number; bold?: boolean; italic?: boolean; underline?: unknown; color?: { argb?: string } }) {
  let content = escapeHtml(value).replace(/\n/g, "<br>") || "<br>";
  if (font?.bold) content = `<strong>${content}</strong>`;
  if (font?.italic) content = `<em>${content}</em>`;
  if (font?.underline) content = `<u>${content}</u>`;
  const family = fontToken(font?.name);
  const size = nearestSize(font?.size);
  const color = colorToken(font?.color?.argb);
  const attributes = [`data-font-family="${family}"`, `data-font-size="${size}"`, color ? `data-text-color="${color}"` : ""].filter(Boolean).join(" ");
  return `<span ${attributes}>${content}</span>`;
}

function fontToken(name?: string) {
  const normalized = (name || "").toLowerCase();
  if (normalized.includes("雅黑") || normalized.includes("yahei")) return "yahei";
  if (normalized.includes("苹方") || normalized.includes("pingfang")) return "pingfang";
  if (normalized.includes("宋") || normalized.includes("simsun")) return "simsun";
  if (normalized.includes("黑体") || normalized.includes("simhei")) return "simhei";
  if (normalized.includes("楷") || normalized.includes("kaiti")) return "kaiti";
  if (normalized.includes("仿宋") || normalized.includes("fangsong")) return "fangsong";
  if (normalized.includes("georgia") || normalized.includes("times")) return "georgia";
  if (normalized.includes("arial")) return "arial";
  return "noto-sans";
}

function nearestSize(value?: number) {
  const sizes = [12, 14, 16, 18, 20, 24, 28, 32, 36];
  return String(sizes.reduce((closest, size) => Math.abs(size - (value || 16)) < Math.abs(closest - (value || 16)) ? size : closest, 16));
}

function colorToken(argb?: string) {
  if (!argb) return "";
  const value = argb.slice(-6).toUpperCase();
  const [red, green, blue] = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) => Number.parseInt(part, 16));
  if (red > 180 && green < 150 && blue < 150) return "red";
  if (blue > red + 30 && blue > green) return "blue";
  if (green > red + 20 && green > blue) return "green";
  if (red > 170 && green > 130 && blue < 120) return "gold";
  if (green > 140 && blue > 120) return "teal";
  return "";
}

function strongestBorder(border: Record<string, { style?: string }> | undefined) {
  const styles = Object.values(border || {}).map((side) => side?.style).filter(Boolean) as string[];
  const width = styles.some((style) => style === "double") ? 4 : styles.some((style) => style === "thick") ? 3 : styles.some((style) => style?.includes("medium")) ? 2 : 1;
  const style = styles.some((value) => value?.includes("dash")) ? "dashed" : styles.some((value) => value?.includes("dot")) ? "dotted" : "solid";
  return { width, style };
}

export async function readWebPage(url: string): Promise<ImportPreview> {
  const { data, error } = await supabase.functions.invoke("import-url", { body: { url } });
  if (error) throw error;
  return {
    kind: "web",
    title: data.title || url,
    bodyHtml: sanitizeHtml(data.bodyHtml),
    bodyText: data.text || "",
    images: Array.isArray(data.images) ? data.images : [],
    source: data.source || url
  };
}
