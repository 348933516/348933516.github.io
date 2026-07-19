import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export interface VideoProbe {
  playable: boolean;
  width: number;
  height: number;
  durationMs: number;
}

export interface VideoConversionProgress {
  phase: "detecting" | "converting" | "ready";
  percent: number;
}

let ffmpegPromise: Promise<FFmpeg> | null = null;

function waitForFrame(video: HTMLVideoElement) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(false), 2600);
    const frameVideo = video as HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number };
    if (typeof frameVideo.requestVideoFrameCallback === "function") {
      frameVideo.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        finish(video.videoWidth > 0 && video.videoHeight > 0);
      });
      return;
    }
    const onLoadedData = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", onLoadedData);
      finish(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0);
    };
    video.addEventListener("loadeddata", onLoadedData, { once: true });
  });
}

export async function probeVideo(input: File | string): Promise<VideoProbe> {
  const url = typeof input === "string" ? input : URL.createObjectURL(input);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("视频容器无法读取")); };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.load();
    });
    try { await video.play(); } catch { /* muted autoplay can still be blocked */ }
    const playable = await waitForFrame(video);
    return {
      playable,
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (typeof input !== "string") URL.revokeObjectURL(url);
  }
}

async function loadFfmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const base = import.meta.env.BASE_URL;
      await ffmpeg.load({
        coreURL: `${base}ffmpeg/ffmpeg-core.js`,
        wasmURL: `${base}ffmpeg/ffmpeg-core.wasm`
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

export async function convertToPlayableMp4(file: File, onProgress: (value: number) => void) {
  const ffmpeg = await loadFfmpeg();
  const handleProgress = ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
  ffmpeg.on("progress", handleProgress);
  const inputName = "input-video";
  const outputName = "maplestorynk-playable.mp4";
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
      "-i", inputName,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "veryfast",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "128k",
      outputName
    ]);
    const output = await ffmpeg.readFile(outputName);
    const bytes = output instanceof Uint8Array ? new Uint8Array(output) : new TextEncoder().encode(output);
    return new File([bytes.buffer], file.name.replace(/\.[^.]+$/, "") + "-h264.mp4", { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", handleProgress);
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
}

export async function fetchVideoFile(url: string, name: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`视频下载失败（${response.status}）`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "video/mp4" });
}
