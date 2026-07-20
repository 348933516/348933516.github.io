import ExcelJS from "exceljs";
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
  wordImages?: { count: number; totalOriginalBytes: number };
}

export interface UploadedWordImage {
  id: string;
  mediaId: string;
  displayUrl: string;
}

export interface WordUploadSession {
  supabaseUrl: string;
  publishableKey: string;
  accessToken: string;
  bucket: string;
  importId: string;
  uploadPrefix: string;
  existingMediaCount: number;
  expectedImages: number;
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
    if (file.size > 400 * 1024 * 1024) throw new Error("Word 文件不能超过 400MB");
    const result = await runWordWorker(file, "preview");
    const bodyHtml = prepareWordHtml(result.html, new Map());
    return {
      kind: "document",
      title: file.name.replace(/\.[^.]+$/, ""),
      bodyHtml,
      bodyText: new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent || "",
      images: [],
      source: file.name,
      wordImages: { count: result.imageCount, totalOriginalBytes: result.totalOriginalBytes },
      warning: result.imageCount
        ? `检测到 ${result.imageCount} 张内嵌图片。确认后会直接保存原始图片，不缩放、不转码、不降低画质。`
        : "Word 常用文字、标题、列表和表格已转换。"
    };
  }
  const bodyText = await file.text();
  const bodyHtml = lowerName.endsWith(".html") ? sanitizeHtml(bodyText) : sanitizeHtml(textToHtml(bodyText));
  return { kind: "document", title: file.name.replace(/\.[^.]+$/, ""), bodyHtml, bodyText: new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent || bodyText, images: [], source: file.name };
}

type WordWorkerResult = { html: string; imageCount: number; totalOriginalBytes: number; warnings: string[]; uploadedImages: UploadedWordImage[] };

function runWordWorker(file: File, mode: "preview" | "extract", onProgress?: (current: number) => void, upload?: WordUploadSession) {
  return new Promise<WordWorkerResult>(async (resolve, reject) => {
    const worker = new Worker(new URL("./document.worker.ts", import.meta.url), { type: "module" });
    const uploadedImages: UploadedWordImage[] = [];
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      action();
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || "Word Worker 加载失败")));
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const message = event.data;
      if (message.type === "progress") {
        if (message.phase === "registered") onProgress?.(Number(message.current || 0));
        return;
      }
      if (message.type === "asset") {
        uploadedImages.push(message.asset as unknown as UploadedWordImage);
        return;
      }
      if (message.type === "error") return finish(() => reject(new Error(String(message.message || "Word 解析失败"))));
      if (message.type === "complete") finish(() => resolve({ ...(message as unknown as WordWorkerResult), uploadedImages }));
    };
    try {
      const buffer = await file.arrayBuffer();
      worker.postMessage({ type: "start", mode, buffer, upload }, [buffer]);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function prepareWordHtml(html: string, uploaded: Map<string, UploadedWordImage>) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll<HTMLImageElement>('img[src^="https://word-import.invalid/"]').forEach((image) => {
    const id = new URL(image.src).pathname.slice(1);
    const label = `图片 ${id.replace("word-image-", "")}`;
    const replacement = uploaded.get(id);
    const figure = document.createElement("figure");
    if (!replacement) {
      figure.className = "word-image-placeholder";
      figure.textContent = `${label}，确认导入后上传原图`;
    } else {
      figure.setAttribute("data-editor-image", "true");
      figure.setAttribute("data-media-id", replacement.mediaId);
      const resultImage = document.createElement("img");
      resultImage.src = replacement.displayUrl;
      resultImage.alt = label;
      figure.append(resultImage);
    }
    const parent = image.parentElement;
    if (parent?.tagName === "P" && parent.children.length === 1 && !parent.textContent?.trim()) parent.replaceWith(figure);
    else image.replaceWith(figure);
  });
  return sanitizeHtml(document.body.innerHTML);
}

export async function materializeWordDocument(file: File, upload: WordUploadSession, onProgress?: (current: number) => void) {
  const result = await runWordWorker(file, "extract", onProgress, upload);
  const uploaded = new Map(result.uploadedImages.map((image) => [image.id, image]));
  return {
    bodyHtml: prepareWordHtml(result.html, uploaded),
    bodyText: new DOMParser().parseFromString(result.html, "text/html").body.textContent || "",
    imageCount: result.imageCount,
    totalOriginalBytes: result.totalOriginalBytes,
    uploadedImageCount: result.uploadedImages.length
  };
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
