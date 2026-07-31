#!/usr/bin/env python3
"""Serial outbound-only FFmpeg worker for MapleStoryNK video jobs."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


ENDPOINT = os.environ.get("VIDEO_TRANSCODE_ENDPOINT", "").rstrip("/")
TOKEN = os.environ.get("VIDEO_WORKER_TOKEN", "")
WORKER_ID = os.environ.get("VIDEO_WORKER_ID", f"lighthouse-{socket.gethostname()}")
POLL_SECONDS = max(3, int(os.environ.get("VIDEO_WORKER_POLL_SECONDS", "10")))
TEMP_ROOT = Path(os.environ.get("VIDEO_WORKER_TEMP", "/var/tmp/maplestorynk-video"))
MAX_BYTES = 1024 * 1024 * 1024


def clean_error(error: Exception) -> str:
    message = re.sub(r"https?://\S+", "[url]", str(error), flags=re.IGNORECASE)
    message = re.sub(r"(?i)(authorization|token|secret)[=:][^\s,;]+", r"\1=[redacted]", message)
    return message.replace("\n", " ")[-500:]


def api(payload: dict, timeout: int = 60) -> dict:
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps({**payload, "workerId": WORKER_ID}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-video-worker-token": TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def heartbeat(job_id: str, status: str, progress: int) -> None:
    api({"action": "heartbeat", "jobId": job_id, "status": status, "progress": progress})


def download(job_id: str, url: str, destination: Path, expected_size: int) -> None:
    if expected_size <= 0 or expected_size > MAX_BYTES:
        raise ValueError("input size is outside the 1GB worker limit")
    request = urllib.request.Request(url, method="GET")
    written = 0
    last_heartbeat = time.monotonic()
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_BYTES:
                raise ValueError("download exceeded the 1GB worker limit")
            output.write(chunk)
            if time.monotonic() - last_heartbeat >= 10:
                heartbeat(job_id, "claimed", 0)
                last_heartbeat = time.monotonic()
    if written != expected_size:
        raise ValueError(f"download size mismatch: expected {expected_size}, received {written}")


def upload(job_id: str, spec: dict, source: Path) -> None:
    headers = {str(key): str(value) for key, value in spec.get("headers", {}).items()}
    command = ["curl", "--fail", "--silent", "--show-error", "--retry", "2", "--max-time", "1800", "-X", "PUT"]
    for name, value in headers.items():
        command.extend(["-H", f"{name}: {value}"])
    command.extend(["--upload-file", str(source), str(spec["url"])])
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    started = time.monotonic()
    last_heartbeat = started
    try:
        while process.poll() is None:
            if time.monotonic() - started > 1900:
                raise TimeoutError("COS upload exceeded the worker timeout")
            if time.monotonic() - last_heartbeat >= 10:
                heartbeat(job_id, "uploading", 96)
                last_heartbeat = time.monotonic()
            time.sleep(1)
        _, stderr = process.communicate()
        if process.returncode != 0:
            raise RuntimeError(stderr[-1500:] or "COS upload failed")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def probe(source: Path) -> tuple[int, float]:
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=r_frame_rate", "-of", "json", str(source)],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    payload = json.loads(completed.stdout)
    duration = float(payload.get("format", {}).get("duration") or 0)
    frame_rate = str((payload.get("streams") or [{}])[0].get("r_frame_rate") or "30/1")
    numerator, _, denominator = frame_rate.partition("/")
    fps = float(numerator or 30) / max(1.0, float(denominator or 1))
    return max(0, round(duration * 1000)), min(60.0, max(1.0, fps))


def transcode(job_id: str, source: Path, output: Path, duration_ms: int, fps: float) -> None:
    scale = "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    command = [
        "ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(source),
        "-map", "0:v:0", "-map", "0:a:0?", "-vf", scale,
        "-r", f"{fps:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "21",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", "-progress", "pipe:1", str(output),
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    last_heartbeat = 0.0
    assert process.stdout is not None
    for line in process.stdout:
        if not line.startswith("out_time_ms="):
            continue
        out_microseconds = int(line.partition("=")[2].strip() or 0)
        progress = min(94, max(1, round((out_microseconds / 1000) / max(1, duration_ms) * 94)))
        if time.monotonic() - last_heartbeat >= 10:
            api({"action": "heartbeat", "jobId": job_id, "status": "transcoding", "progress": progress})
            last_heartbeat = time.monotonic()
    stderr = process.stderr.read() if process.stderr else ""
    if process.wait() != 0:
        raise RuntimeError(stderr[-1500:] or "ffmpeg exited with an error")


def create_poster(output: Path, poster: Path, duration_ms: int) -> None:
    seek = min(3.0, max(0.1, duration_ms / 1000 * 0.1))
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-ss", f"{seek:.3f}", "-i", str(output), "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", str(poster)],
        check=True,
        capture_output=True,
        timeout=120,
    )


def process_job(job: dict) -> None:
    job_id = str(job["id"])
    directory = Path(tempfile.mkdtemp(prefix=f"{job_id}-", dir=TEMP_ROOT))
    source = directory / "source"
    output = directory / "output.mp4"
    poster = directory / "poster.webp"
    try:
        download(job_id, str(job["inputUrl"]), source, int(job["inputSizeBytes"]))
        duration_ms, fps = probe(source)
        transcode(job_id, source, output, duration_ms, fps)
        if output.stat().st_size <= 0:
            raise RuntimeError("ffmpeg produced an empty output")
        create_poster(output, poster, duration_ms)
        api({"action": "heartbeat", "jobId": job_id, "status": "uploading", "progress": 96})
        uploads = api({"action": "upload-urls", "jobId": job_id})
        upload(job_id, uploads["output"], output)
        upload(job_id, uploads["poster"], poster)
        api({"action": "heartbeat", "jobId": job_id, "status": "verifying", "progress": 99})
        api({"action": "complete", "jobId": job_id, "durationMs": duration_ms}, timeout=120)
    except Exception as error:  # Worker logs only a sanitized tail; URLs and tokens never leave memory.
        message = clean_error(error)
        try:
            api({"action": "fail", "jobId": job_id, "errorCode": type(error).__name__.upper(), "errorMessage": message})
        except Exception:
            pass
        raise
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def main() -> None:
    if not ENDPOINT.startswith("https://") or len(TOKEN) < 32:
        raise SystemExit("VIDEO_TRANSCODE_ENDPOINT and a strong VIDEO_WORKER_TOKEN are required")
    for executable in ("ffmpeg", "ffprobe", "curl"):
        if not shutil.which(executable):
            raise SystemExit(f"{executable} is not installed")
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            response = api({"action": "claim"})
            job = response.get("job")
            if job:
                process_job(job)
                continue
            time.sleep(max(POLL_SECONDS, int(response.get("retryAfterSeconds") or POLL_SECONDS)))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(POLL_SECONDS)
        except Exception as error:
            print(f"worker job failed: {type(error).__name__}: {clean_error(error)[-300:]}", flush=True)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
