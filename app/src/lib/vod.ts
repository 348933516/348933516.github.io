import { EdgeFunctionError, invokeEdgeFunction } from "./edgeFunctions";

export const vodUploadEnabled = import.meta.env.VITE_TENCENT_VOD_ENABLED === "true";

export interface VodUploadResult {
  appId: number;
  fileId: string;
  playbackUrl: string;
  posterUrl: string;
}

export async function uploadVideoToVod(file: File, onProgress: (percent: number) => void): Promise<VodUploadResult> {
  if (!vodUploadEnabled) {
    throw new EdgeFunctionError({
      functionName: "vod",
      stage: "route",
      status: 409,
      code: "VOD_DISABLED",
      message: "VOD is disabled; compatible MP4/WebM videos must use COS"
    });
  }

  const signatureResult = await invokeEdgeFunction<{ signature?: string; appId?: number }>("vod-signature", {}, "signature");
  const signature = String(signatureResult.signature || "");
  const appId = Number(signatureResult.appId || 0);
  if (!signature || !appId) {
    throw new EdgeFunctionError({
      functionName: "vod-signature",
      stage: "signature",
      status: 502,
      code: "VOD_CONFIG_INVALID",
      message: "VOD signature response is incomplete"
    });
  }

  const { default: TcVod } = await import("vod-js-sdk-v6");
  const vod = new TcVod({ getSignature: async () => signature, appId, enableResume: true });
  const uploader = vod.upload({ mediaFile: file, mediaName: file.name.replace(/\.[^.]+$/, ""), enableResume: true });
  uploader.on("media_progress", (event: { percent?: number }) => onProgress(Math.round(Math.max(0, Math.min(1, Number(event.percent || 0))) * 100)));
  uploader.start();
  const result = await uploader.done() as Record<string, unknown> & { video?: { url?: string }; cover?: { url?: string }; fileId?: string };
  const playbackUrl = String(result.video?.url || "").replace(/^http:/i, "https:");
  const fileId = String(result.fileId || "");
  if (!fileId) {
    throw new EdgeFunctionError({
      functionName: "vod",
      stage: "upload",
      status: 502,
      code: "VIDEO_RESULT_INVALID",
      message: "VOD did not return a file id"
    });
  }
  return { appId, fileId, playbackUrl, posterUrl: String(result.cover?.url || "").replace(/^http:/i, "https:") };
}

export function saveVodMedia(input: { contentId: string; mediaId?: string; file: File; upload: VodUploadResult; sortOrder?: number }) {
  return invokeEdgeFunction("vod-complete", {
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
  }, "complete");
}

export function importExistingVideo(mediaId: string, sourceUrl: string) {
  return invokeEdgeFunction<{ status: "processing"; taskId: string }>("vod-import", { mediaId, sourceUrl }, "import");
}

export function refreshVodStatus(mediaId: string) {
  return invokeEdgeFunction<{ status: "processing" | "ready" | "failed"; error?: string }>("vod-status", { mediaId }, "status");
}
