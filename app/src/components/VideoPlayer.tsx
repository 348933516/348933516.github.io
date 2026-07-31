import { useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import type { ContentMedia } from "../types";

export function VideoPlayer({ media }: { media: Pick<ContentMedia, "src" | "title" | "mimeType" | "processingStatus" | "videoProvider" | "providerFileId" | "providerAppId" | "playbackUrl" | "posterUrl"> }) {
  const [failure, setFailure] = useState<"network" | "video-codec" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const frameTimeout = useRef<number | null>(null);
  useEffect(() => () => {
    if (frameTimeout.current !== null) window.clearTimeout(frameTimeout.current);
  }, []);
  const reload = () => {
    if (frameTimeout.current !== null) window.clearTimeout(frameTimeout.current);
    frameTimeout.current = null;
    setFailure(null);
    setReloadKey((value) => value + 1);
  };
  const verifyDecodedFrame = (video: HTMLVideoElement) => {
    if (frameTimeout.current !== null) window.clearTimeout(frameTimeout.current);
    let decodedFrame = false;
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => {
        decodedFrame = true;
        if (frameTimeout.current !== null) window.clearTimeout(frameTimeout.current);
        frameTimeout.current = null;
      });
    } else if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      decodedFrame = true;
    }
    frameTimeout.current = window.setTimeout(() => {
      frameTimeout.current = null;
      if (!decodedFrame && video.currentTime > 0.5 && !video.paused) setFailure("video-codec");
    }, 3_000);
  };
  if (media.processingStatus === "failed") return <div className="media-video-error"><strong>视频处理失败</strong><span>请在媒体库中重新上传。</span></div>;
  if (media.videoProvider === "tencent_vod" && media.providerFileId && media.providerAppId) {
    const source = `https://player.vod2.myqcloud.com/v3/console/vod-player.html?appid=${encodeURIComponent(media.providerAppId)}&fileid=${encodeURIComponent(media.providerFileId)}&autoplay=0`;
    return <div className="cloud-video-player"><iframe key={reloadKey} src={source} title={media.title || "视频播放器"} loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen onLoad={() => setFailure(null)} onError={() => setFailure("network")} />{media.processingStatus === "processing" && <span className="vod-processing">云端正在生成兼容播放版本</span>}{failure && <button className="button quiet" onClick={reload}><RefreshCcw />重新加载</button>}</div>;
  }
  const source = media.playbackUrl || media.src;
  const type = media.mimeType || (source.endsWith(".webm") ? "video/webm" : "video/mp4");
  if (!source) return <div className="media-video-error"><strong>视频尚未公开</strong><span>请在后台发布本次媒体更新后再播放。</span></div>;
  if (failure === "video-codec") return <div className="media-video-error"><strong>视频有声音但没有画面</strong><span>该文件的视频编码与当前浏览器不兼容。请转换为 H.264/AAC MP4 后重新上传；仅修改扩展名不会转换编码。</span></div>;
  if (failure === "network") return <div className="media-video-error"><strong>浏览器暂时无法播放这个视频</strong><span>请检查网络后重试；如果仍然失败，请确认视频为 H.264/AAC MP4 或 WebM。</span><button className="button quiet" onClick={reload}><RefreshCcw />重新加载</button></div>;
  return <video key={reloadKey} controls preload="metadata" playsInline poster={media.posterUrl} onPlay={(event) => verifyDecodedFrame(event.currentTarget)} onError={() => setFailure("network")}><source src={source} type={type} /></video>;
}
