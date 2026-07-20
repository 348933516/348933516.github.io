import { useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { ContentMedia } from "../types";

export function VideoPlayer({ media }: { media: Pick<ContentMedia, "src" | "title" | "mimeType" | "processingStatus" | "videoProvider" | "providerFileId" | "providerAppId"> }) {
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  if (media.processingStatus === "failed") return <div className="media-video-error"><strong>视频处理失败</strong><span>请在媒体库中重新上传。</span></div>;
  if (media.videoProvider === "tencent_vod" && media.providerFileId && media.providerAppId) {
    const source = `https://player.vod2.myqcloud.com/v3/console/vod-player.html?appid=${encodeURIComponent(media.providerAppId)}&fileid=${encodeURIComponent(media.providerFileId)}&autoplay=0`;
    return <div className="cloud-video-player"><iframe key={reloadKey} src={source} title={media.title || "视频播放器"} loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen onLoad={() => setFailed(false)} onError={() => setFailed(true)} />{media.processingStatus === "processing" && <span className="vod-processing">云端正在生成兼容播放版本</span>}{failed && <button className="button quiet" onClick={() => { setFailed(false); setReloadKey((value) => value + 1); }}><RefreshCcw />重新加载</button>}</div>;
  }
  const type = media.mimeType || (media.src.endsWith(".webm") ? "video/webm" : "video/mp4");
  if (failed) return <div className="media-video-error"><strong>浏览器无法播放这个旧视频</strong><span>请在后台点击“迁移到云点播”。</span><button className="button quiet" onClick={() => { setFailed(false); setReloadKey((value) => value + 1); }}><RefreshCcw />重新加载</button></div>;
  return <video key={reloadKey} controls preload="metadata" playsInline poster={undefined} onError={() => setFailed(true)}><source src={media.src} type={type} /></video>;
}
