import { sanitizeHtml } from "./sanitize";
import { supabase } from "./supabase";

export interface ImportPreview {
  title: string;
  bodyHtml: string;
  bodyText: string;
  images: string[];
  source: string;
  warning?: string;
}

export async function readDocument(file: File): Promise<ImportPreview> {
  if (file.name.toLowerCase().endsWith(".docx")) {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) }
    );
    const bodyHtml = sanitizeHtml(result.value);
    return {
      title: file.name.replace(/\.[^.]+$/, ""),
      bodyHtml,
      bodyText: new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent || "",
      images: [],
      source: file.name,
      warning: "Word 正文已读取。文档内图片请在媒体区单独批量上传，以便安全保存。"
    };
  }
  const bodyText = await file.text();
  const bodyHtml = sanitizeHtml(bodyText.split(/\n{2,}/).filter(Boolean).map((paragraph) => `<p>${paragraph.replace(/[&<>]/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[value] || value)}</p>`).join(""));
  return { title: file.name.replace(/\.[^.]+$/, ""), bodyHtml, bodyText, images: [], source: file.name };
}

export async function readWebPage(url: string): Promise<ImportPreview> {
  const { data, error } = await supabase.functions.invoke("import-url", { body: { url } });
  if (error) throw error;
  return {
    title: data.title || url,
    bodyHtml: sanitizeHtml(data.bodyHtml),
    bodyText: data.text || "",
    images: Array.isArray(data.images) ? data.images : [],
    source: data.source || url
  };
}
