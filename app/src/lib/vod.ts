import { supabase } from "./supabase";

export interface VodUploadResult {
  appId: number;
  fileId: string;
  playbackUrl: string;
  posterUrl: string;
}

export async function uploadVideoToVod(file: File, onProgress: (percent: number) => void): Promise<VodUploadResult> {
  const [{ default: TcVod }, signatureResult] = await Promise.all([
    import("vod-js-sdk-v6"),
    supabase.functions.invoke("vod-signature", { body: {} })
  ]);
  if (signatureResult.error || signatureResult.data?.error) {
    throw new Error(signatureResult.data?.error || signatureResult.error?.message || "腾讯云点播尚未配置");
  }
  const signature = String(signatureResult.data.signature || "");
  const appId = Number(signatureResult.data.appId || 0);
  if (!signature || !appId) throw new Error("腾讯云点播签名配置不完整");
  const vod = new TcVod({ getSignature: async () => signature, appId, enableResume: true });
  const uploader = vod.upload({ mediaFile: file, mediaName: file.name.replace(/\.[^.]+$/, ""), enableResume: true });
  uploader.on("media_progress", (event: { percent?: number }) => onProgress(Math.round(Math.max(0, Math.min(1, Number(event.percent || 0))) * 100)));
  uploader.start();
  const result = await uploader.done() as Record<string, unknown> & { video?: { url?: string }; cover?: { url?: string }; fileId?: string };
  const playbackUrl = String(result.video?.url || "").replace(/^http:/i, "https:");
  const fileId = String(result.fileId || "");
  if (!fileId) throw new Error("腾讯云点播没有返回 FileId");
  return { appId, fileId, playbackUrl, posterUrl: String(result.cover?.url || "").replace(/^http:/i, "https:") };
}

export async function saveVodMedia(input: { contentId: string; mediaId?: string; file: File; upload: VodUploadResult; sortOrder?: number }) {
  const { data, error } = await supabase.functions.invoke("vod-complete", {
    body: {
      contentId: input.contentId,
      mediaId: input.mediaId,
      fileId: input.upload.fileId,
      appId: input.upload.appId,
      playbackUrl: input.upload.playbackUrl,
      posterUrl: input.upload.posterUrl,
      title: input.file.name.replace(/\.[^.]+$/, ""),
      mimeType: input.file.type || "video/mp4",
      sizeBytes: input.file.size,
      sortOrder: input.sortOrder || 100
    }
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || "视频记录保存失败");
  return data;
}

export async function importExistingVideo(mediaId: string, sourceUrl: string) {
  const { data, error } = await supabase.functions.invoke("vod-import", { body: { mediaId, sourceUrl } });
  if (error || data?.error) throw new Error(data?.error || error?.message || "旧视频导入失败");
  return data as { status: "processing"; taskId: string };
}

export async function refreshVodStatus(mediaId: string) {
  const { data, error } = await supabase.functions.invoke("vod-status", { body: { mediaId } });
  if (error || data?.error) throw new Error(data?.error || error?.message || "视频状态查询失败");
  return data as { status: "processing" | "ready" | "failed"; error?: string };
}
