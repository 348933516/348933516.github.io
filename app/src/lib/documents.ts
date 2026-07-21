import ExcelJS from "exceljs";
import { toTransferableArrayBuffer } from "./documentWorkerBuffer";
import { getDocumentImportStatus, registerDocumentImportAsset, type DocumentImportAsset } from "./repository";
import { sanitizeHtml } from "./sanitize";
import { supabase } from "./supabase";
import { uploadSupabaseTus } from "./tusUpload";

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

export interface ParsedWordImage {
  id: string;
  index: number;
  hash: string;
  mimeType: string;
  extension: string;
  original: ArrayBuffer;
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

export type WordImportProgress = {
  phase: "parsed" | "uploading" | "uploaded" | "registered" | "resumed" | "retry" | "fallback";
  imageIndex: number;
  imageCount: number;
  loaded?: number;
  total?: number;
  retries?: number;
  detail?: string;
};

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

type WordWorkerResult = { html: string; imageCount: number; totalOriginalBytes: number; warnings: string[] };

function runWordWorker(file: File, mode: "preview" | "extract", onImage?: (image: ParsedWordImage) => Promise<void>, onProgress?: (current: number) => void, onFallback?: () => void) {
  return new Promise<WordWorkerResult>(async (resolve, reject) => {
    const worker = new Worker(new URL("./document.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    let deliveredImages = 0;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      action();
    };
    const useCompatibilityParser = (workerError?: Error) => {
      if (settled) return;
      if (mode !== "extract" || !onImage) return finish(() => reject(workerError || new Error("Word Worker 加载失败")));
      settled = true;
      worker.terminate();
      onFallback?.();
      void parseWordWithCompatibilityMode(file, onImage).then(resolve).catch(reject);
    };
    worker.onerror = (event) => useCompatibilityParser(new Error(event.message || "Word Worker 加载失败"));
    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(Number(message.current || 0));
        return;
      }
      if (message.type === "image") {
        if (!onImage) return finish(() => reject(new Error("Word 图片处理器未配置。")));
        const image = message.image as unknown as ParsedWordImage;
        deliveredImages += 1;
        void onImage(image).then(() => worker.postMessage({ type: "ack", id: image.id })).catch((error) => {
          worker.postMessage({ type: "ack", id: image.id, error: error instanceof Error ? error.message : "图片上传失败" });
          finish(() => reject(error instanceof Error ? error : new Error("图片上传失败")));
        });
        return;
      }
      if (message.type === "error") return deliveredImages === 0
        ? useCompatibilityParser(new Error(String(message.message || "Word 解析失败")))
        : finish(() => reject(new Error(String(message.message || "Word 解析失败"))));
      if (message.type === "complete") {
        const result = message as unknown as WordWorkerResult;
        if (mode === "extract" && result.imageCount > 0 && deliveredImages === 0) return useCompatibilityParser();
        finish(() => resolve(result));
      }
    };
    try {
      const buffer = await file.arrayBuffer();
      worker.postMessage({ type: "start", mode, buffer }, [buffer]);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export async function parseWordWithCompatibilityMode(file: File, onImage: (image: ParsedWordImage) => Promise<void>): Promise<WordWorkerResult> {
  const mammoth = (await import("mammoth")).default;
  let imageCount = 0;
  let deliveredImages = 0;
  let totalOriginalBytes = 0;
  let imageFailure: Error | null = null;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          imageCount += 1;
          const id = `word-image-${imageCount}`;
          const original = toTransferableArrayBuffer(await image.readAsArrayBuffer() as unknown as ArrayBuffer | ArrayBufferView);
          const mimeType = image.contentType || "application/octet-stream";
          totalOriginalBytes += original.byteLength;
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", original))].map((value) => value.toString(16).padStart(2, "0")).join("");
          await onImage({ id, index: imageCount, hash, mimeType, extension: wordImageExtension(mimeType), original });
          deliveredImages += 1;
          return { src: `https://word-import.invalid/${id}`, alt: `图片 ${imageCount}` };
        } catch (error) {
          imageFailure = error instanceof Error ? error : new Error("Word 兼容模式图片处理失败");
          throw imageFailure;
        }
      }),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"]
    }
  );
  if (imageFailure) throw imageFailure;
  if (imageCount !== deliveredImages) throw new Error(`Word 兼容模式处理不完整：解析 ${imageCount} 张，已提交 ${deliveredImages} 张。`);
  return { html: result.value, imageCount, totalOriginalBytes, warnings: result.messages.map((entry) => entry.message) };
}

function wordImageExtension(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  return "bin";
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

export async function materializeWordDocument(file: File, upload: WordUploadSession, onProgress?: (progress: WordImportProgress) => void) {
  const status = await getDocumentImportStatus(upload.importId);
  const registeredByIndex = new Map((status.assets || []).map((asset) => [asset.image_index, asset]));
  const result = await runWordWorker(file, "extract", async (image) => {
    const existing = registeredByIndex.get(image.index);
    if (existing) {
      onProgress?.({ phase: "resumed", imageIndex: image.index, imageCount: upload.expectedImages, detail: "已从服务端清单恢复" });
      return;
    }
    onProgress?.({ phase: "parsed", imageIndex: image.index, imageCount: upload.expectedImages, total: image.original.byteLength });
    const mediaId = await deterministicUuid(`${upload.importId}:${image.index}`);
    const originalPath = `${upload.uploadPrefix}/${String(image.index).padStart(3, "0")}-${mediaId}-original.${image.extension}`;
    const blob = new File([image.original], `word-image-${image.index}.${image.extension}`, { type: image.mimeType });
    const asset: DocumentImportAsset = {
      mediaId, imageIndex: image.index, originalPath, displayPath: originalPath, hash: image.hash, mimeType: image.mimeType,
      width: 0, height: 0, originalSize: blob.size, displaySize: blob.size,
      sortOrder: (upload.existingMediaCount + image.index) * 10, title: `图片 ${image.index}`, altText: `图片 ${image.index}`
    };
    await uploadSupabaseTus({
      file: blob,
      endpoint: `${upload.supabaseUrl}/storage/v1/upload/resumable`,
      accessToken: upload.accessToken,
      publishableKey: upload.publishableKey,
      bucket: upload.bucket,
      objectPath: originalPath,
      fingerprint: `maplestorynk-word:${upload.importId}:${image.index}:${image.hash}`,
      onProgress: (value) => onProgress?.({ phase: "uploading", imageIndex: image.index, imageCount: upload.expectedImages, loaded: value.loaded, total: value.total, retries: value.retries }),
      onEvent: (event) => onProgress?.({ phase: event.phase === "complete" ? "uploaded" : event.phase === "resume" ? "resumed" : event.phase, imageIndex: image.index, imageCount: upload.expectedImages, retries: event.retries, detail: event.detail })
    });
    await registerDocumentImportAsset(upload.importId, asset);
    registeredByIndex.set(image.index, { image_index: image.index, media_id: mediaId, display_path: originalPath });
    onProgress?.({ phase: "registered", imageIndex: image.index, imageCount: upload.expectedImages });
  }, undefined, () => onProgress?.({ phase: "fallback", imageIndex: 1, imageCount: upload.expectedImages, detail: "Worker 未输出图片，已切换浏览器兼容解析模式" }));
  // The server manifest is authoritative. A browser reload or an interrupted
  // TUS request must never make a locally remembered image look committed.
  const completed = await getDocumentImportStatus(upload.importId);
  const registered = (completed.assets || []).slice().sort((left, right) => left.image_index - right.image_index);
  if (registered.length !== result.imageCount) {
    throw new Error(`Word 图片登记不完整：解析 ${result.imageCount} 张，服务端已登记 ${registered.length} 张。`);
  }
  const uploaded = new Map(registered.map((asset) => [`word-image-${asset.image_index}`, registeredWordImage(upload, asset)]));
  return {
    bodyHtml: prepareWordHtml(result.html, uploaded),
    bodyText: new DOMParser().parseFromString(result.html, "text/html").body.textContent || "",
    imageCount: result.imageCount,
    totalOriginalBytes: result.totalOriginalBytes,
    uploadedImageCount: registered.length
  };
}

function registeredWordImage(upload: WordUploadSession, asset: { image_index: number; media_id: string; display_path: string }): UploadedWordImage {
  const objectPath = asset.display_path.split("/").map(encodeURIComponent).join("/");
  return {
    id: `word-image-${asset.image_index}`,
    mediaId: asset.media_id,
    displayUrl: `${upload.supabaseUrl}/storage/v1/object/public/${upload.bucket}/${objectPath}`
  };
}

async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hexValue = [...bytes.slice(0, 16)].map((item) => item.toString(16).padStart(2, "0")).join("");
  return `${hexValue.slice(0, 8)}-${hexValue.slice(8, 12)}-${hexValue.slice(12, 16)}-${hexValue.slice(16, 20)}-${hexValue.slice(20)}`;
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
