import { mediaBaseUrl } from "./config";
import { probeBrowserVideoPlayback } from "./uploads";

export type BrowserVideoStage = "checking" | "loading" | "transcoding" | "poster" | "verifying";

export interface PreparedBrowserVideo {
  video: File;
  poster: File;
  converted: boolean;
  codec: "browser-compatible" | "h264+aac";
  durationMs: number;
  width: number;
  height: number;
}

export interface BrowserVideoProgress {
  stage: BrowserVideoStage;
  percent: number;
}

type ProgressHandler = (progress: BrowserVideoProgress) => void;

const standardLimit = 300 * 1024 * 1024;
const lowMemoryLimit = 128 * 1024 * 1024;
const ffmpegCoreVersion = "0.12.10-r2";
const ffmpegWasmPartCount = 8;
let ffmpegPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;
let activeProgress: ProgressHandler | null = null;
let transcodeQueue: Promise<unknown> = Promise.resolve();

export function browserVideoTranscodeLimit(deviceMemory?: number) {
  return deviceMemory && deviceMemory < 4 ? lowMemoryLimit : standardLimit;
}

export function buildVideoTranscodeArguments(inputName: string, outputName: string) {
  return [
    "-i", inputName,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    outputName
  ];
}

export async function prepareBrowserVideo(file: File, onProgress: ProgressHandler = () => undefined): Promise<PreparedBrowserVideo> {
  const task = transcodeQueue.then(() => prepareBrowserVideoNow(file, onProgress));
  transcodeQueue = task.catch(() => undefined);
  return task;
}

async function prepareBrowserVideoNow(file: File, onProgress: ProgressHandler): Promise<PreparedBrowserVideo> {
  onProgress({ stage: "checking", percent: 1 });
  const probe = await probeBrowserVideoPlayback(file, file.name);
  if (probe.playable) {
    onProgress({ stage: "poster", percent: 88 });
    const poster = await createVideoPoster(file);
    onProgress({ stage: "verifying", percent: 100 });
    return { video: file, poster: poster.file, converted: false, codec: "browser-compatible", durationMs: poster.durationMs, width: poster.width, height: poster.height };
  }

  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0);
  const limit = browserVideoTranscodeLimit(deviceMemory || undefined);
  if (file.size > limit) {
    throw new Error(`当前采用浏览器本地转换，不使用轻量服务器；此设备最多处理 ${Math.round(limit / 1024 / 1024)}MB 的不兼容视频。请先在电脑上转换为 H.264/AAC MP4。`);
  }

  onProgress({ stage: "loading", percent: 4 });
  const ffmpeg = await loadFfmpeg(onProgress);
  const { fetchFile } = await import("@ffmpeg/util");
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || "video";
  const inputName = `source.${extension}`;
  const outputName = "compatible.mp4";
  activeProgress = onProgress;
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    const exitCode = await ffmpeg.exec(buildVideoTranscodeArguments(inputName, outputName));
    if (exitCode !== 0) throw new Error(`本地 FFmpeg 转换失败（退出码 ${exitCode}）`);
    const output = await ffmpeg.readFile(outputName);
    if (typeof output === "string" || output.byteLength === 0) throw new Error("本地 FFmpeg 没有生成可播放视频");
    const video = new File([new Uint8Array(output)], `${file.name.replace(/\.[^.]+$/, "")}-h264.mp4`, { type: "video/mp4" });
    onProgress({ stage: "poster", percent: 94 });
    const poster = await createVideoPoster(video);
    onProgress({ stage: "verifying", percent: 98 });
    const verified = await probeBrowserVideoPlayback(video, video.name);
    if (!verified.playable) throw new Error("转换结果未能解码出画面，文件没有上传");
    onProgress({ stage: "verifying", percent: 100 });
    return { video, poster: poster.file, converted: true, codec: "h264+aac", durationMs: poster.durationMs, width: poster.width, height: poster.height };
  } finally {
    activeProgress = null;
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
}

async function loadFfmpeg(onProgress: ProgressHandler) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const edgeBase = new URL(`${mediaBaseUrl}/site/runtime/ffmpeg/${ffmpegCoreVersion}/`);
      const localBase = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, window.location.origin);
      let lastError: unknown;
      for (const base of [edgeBase, localBase]) {
        const ffmpeg = new FFmpeg();
        let edgeWasmUrl: string | null = null;
        ffmpeg.on("progress", ({ progress }) => {
          activeProgress?.({ stage: "transcoding", percent: Math.max(8, Math.min(92, Math.round(8 + progress * 84))) });
        });
        try {
          edgeWasmUrl = base === edgeBase ? await loadEdgeWasm(base, onProgress) : null;
          await ffmpeg.load({
            coreURL: new URL("ffmpeg-core.js", base).href,
            wasmURL: edgeWasmUrl || new URL("ffmpeg-core.wasm", base).href
          });
          return ffmpeg;
        } catch (error) {
          lastError = error;
        } finally {
          if (edgeWasmUrl) URL.revokeObjectURL(edgeWasmUrl);
        }
      }
      throw lastError instanceof Error ? lastError : new Error("本地视频转换组件加载失败");
    })().catch((error) => {
      ffmpegPromise = null;
      throw error;
    });
  }
  activeProgress = onProgress;
  return ffmpegPromise;
}

async function loadEdgeWasm(base: URL, onProgress: ProgressHandler) {
  let completedParts = 0;
  const parts = await Promise.all(Array.from({ length: ffmpegWasmPartCount }, async (_, index) => {
    const partName = `ffmpeg-core.wasm.part-${String(index + 1).padStart(2, "0")}`;
    const response = await fetch(new URL(partName, base));
    if (!response.ok) throw new Error(`EdgeOne FFmpeg runtime part ${index + 1} returned HTTP ${response.status}`);
    const part = await response.arrayBuffer();
    completedParts += 1;
    onProgress({ stage: "loading", percent: Math.round(4 + (completedParts / ffmpegWasmPartCount) * 3) });
    return part;
  }));
  return URL.createObjectURL(new Blob(parts, { type: "application/wasm" }));
}

async function createVideoPoster(videoFile: File) {
  const video = document.createElement("video");
  const objectUrl = URL.createObjectURL(videoFile);
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;
  try {
    await waitForVideoEvent(video, "loadedmetadata", 15_000, () => video.load());
    const seekTime = Math.min(3, Math.max(0, Number.isFinite(video.duration) ? video.duration * 0.1 : 0));
    if (seekTime > 0.01) {
      await waitForVideoEvent(video, "seeked", 15_000, () => { video.currentTime = seekTime; });
    } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(video, "loadeddata", 15_000);
    }
    if (!video.videoWidth || !video.videoHeight) throw new Error("无法从视频生成封面");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持视频封面画布");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("视频封面生成失败")), "image/webp", 0.84));
    return {
      file: new File([blob], `${videoFile.name.replace(/\.[^.]+$/, "")}-poster.webp`, { type: "image/webp" }),
      durationMs: Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration * 1000)) : 0,
      width: video.videoWidth,
      height: video.videoHeight
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "loadeddata" | "seeked", timeoutMs: number, start?: () => void) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error(`等待视频 ${eventName} 超时`)), timeoutMs);
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
      error ? reject(error) : resolve();
    };
    const onSuccess = () => finish();
    const onError = () => finish(new Error("浏览器无法读取视频画面"));
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
    start?.();
  });
}
