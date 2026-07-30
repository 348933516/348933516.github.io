import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { ContentMedia } from "../types";

export function VideoPlayer({ media }: { media: Pick<ContentMedia, "src" | "title" | "mimeType" | "processingStatus" | "videoProvider" | "providerFileId" | "providerAppId" | "playbackUrl" | "posterUrl"> }) {
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  if (media.processingStatus === "failed") return <div className="media-video-error"><strong>视频处理失败</strong><span>请在媒体库中重新上传。</span></div>;
  if (media.videoProvider === "tencent_vod" && media.providerFileId && media.providerAppId) {
    const source = `https://player.vod2.myqcloud.com/v3/console/vod-player.html?appid=${encodeURIComponent(media.providerAppId)}&fileid=${encodeURIComponent(media.providerFileId)}&autoplay=0`;
    return <div className="cloud-video-player"><iframe key={reloadKey} src={source} title={media.title || "视频播放器"} loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen onLoad={() => setFailed(false)} onError={() => setFailed(true)} />{media.processingStatus === "processing" && <span className="vod-processing">云端正在生成兼容播放版本</span>}{failed && <button className="button quiet" onClick={() => { setFailed(false); setReloadKey((value) => value + 1); }}><RefreshCcw />重新加载</button>}</div>;
  }
  const source = media.playbackUrl || media.src;
  const type = media.mimeType || (source.endsWith(".webm") ? "video/webm" : "video/mp4");
  if (!source) return <div className="media-video-error"><strong>视频尚未公开</strong><span>请在后台发布本次媒体更新后再播放。</span></div>;
  if (failed) return <div className="media-video-error"><strong>浏览器暂时无法播放这个视频</strong><span>请检查网络后重试；如果仍然失败，请确认视频为 H.264/AAC MP4 或 WebM。</span><button className="button quiet" onClick={() => { setFailed(false); setReloadKey((value) => value + 1); }}><RefreshCcw />重新加载</button></div>;
  return <video key={reloadKey} controls preload="metadata" playsInline poster={media.posterUrl} onError={() => setFailed(true)}><source src={source} type={type} /></video>;
}
