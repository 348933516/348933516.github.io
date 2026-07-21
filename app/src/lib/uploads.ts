import { privateMediaBucket, supabasePublishableKey, supabaseUrl } from "./config";
import { supabase } from "./supabase";

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export async function imageToWebp(file: File, maxSide = 2000, quality = 0.86) {
  return (await imageToWebpVariant(file, maxSide, quality)).file;
}

export async function imageToWebpVariant(file: File, maxSide = 1600, quality = 0.92) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return { file, width: 0, height: 0 };
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image conversion failed")), "image/webp", quality));
    return {
      file: new File([blob], file.name.replace(/\.[^.]+$/, `-${maxSide}.webp`), { type: "image/webp" }),
      width: canvas.width,
      height: canvas.height
    };
  } finally {
    bitmap.close();
  }
}

export async function uploadWithProgress(file: File, path: string, onProgress: (progress: UploadProgress) => void, signal?: AbortSignal, bucket = privateMediaBucket, upsert = false) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Please sign in before uploading");
  return new Promise<{ bucket: string; path: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${supabaseUrl}/storage/v1/object/${bucket}/${path}`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("apikey", supabasePublishableKey);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("x-upsert", upsert ? "true" : "false");
    request.upload.onprogress = (event) => onProgress({
      loaded: event.loaded,
      total: event.total || file.size,
      percent: Math.round((event.loaded / (event.total || file.size)) * 100)
    });
    request.onerror = () => reject(new Error("Upload failed"));
    request.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve({ bucket, path });
      else reject(new Error(request.responseText || `Upload failed (${request.status})`));
    };
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export async function imageDimensions(file: File) {
  if (!file.type.startsWith("image/")) return {};
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

export function validateUpload(file: File) {
  const lowerName = file.name.toLowerCase();
  const image = file.type.startsWith("image/");
  const video = ["video/mp4", "video/webm"].includes(file.type) || lowerName.endsWith(".mp4") || lowerName.endsWith(".webm");
  const document = ["application/pdf", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/markdown", "text/html"].includes(file.type) || lowerName.endsWith(".pdf") || lowerName.endsWith(".zip") || lowerName.endsWith(".docx") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".html") || lowerName.endsWith(".htm");
  if (!image && !video && !document) throw new Error(`不支持的文件类型：${file.type || file.name}`);
  const maximum = video ? 2 * 1024 * 1024 * 1024 : 100 * 1024 * 1024;
  if (file.size > maximum) throw new Error(video ? "视频不能超过 2GB" : "单个文件不能超过 100MB");
  return { image, video, document };
}
