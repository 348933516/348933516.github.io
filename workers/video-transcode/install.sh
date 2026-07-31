#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run as root" >&2; exit 1; fi
apt-get update
apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3
id maplestorynk-video >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin maplestorynk-video
install -d -o maplestorynk-video -g maplestorynk-video /opt/maplestorynk-video-worker /var/tmp/maplestorynk-video
install -m 0755 worker.py /opt/maplestorynk-video-worker/worker.py
install -m 0644 maplestorynk-video-worker.service /etc/systemd/system/maplestorynk-video-worker.service
if [ ! -f /etc/maplestorynk-video-worker.env ]; then
  install -m 0600 /dev/null /etc/maplestorynk-video-worker.env
  printf '%s\n' \
    'VIDEO_TRANSCODE_ENDPOINT=https://edznwgvyqpsibnkqqeby.supabase.co/functions/v1/video-transcode' \
    'VIDEO_WORKER_TOKEN=replace-with-the-same-strong-token-configured-in-supabase' \
    'VIDEO_WORKER_ID=maplestorynk-lighthouse-1' > /etc/maplestorynk-video-worker.env
fi
systemctl daemon-reload
systemctl enable maplestorynk-video-worker.service
echo "Edit /etc/maplestorynk-video-worker.env, then run: systemctl restart maplestorynk-video-worker"
