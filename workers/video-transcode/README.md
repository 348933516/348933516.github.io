# Video transcode worker

This worker polls the Supabase `video-transcode` Edge Function over HTTPS. It opens no inbound port and stores no permanent COS or Supabase credentials.

Install on the Tencent Lighthouse server:

```bash
cd /path/to/workers/video-transcode
sudo bash install.sh
sudo nano /etc/maplestorynk-video-worker.env
sudo systemctl restart maplestorynk-video-worker
sudo systemctl status maplestorynk-video-worker
```

Set the same random `VIDEO_WORKER_TOKEN` in Supabase Secrets and `/etc/maplestorynk-video-worker.env`. Use at least 32 random bytes. The worker processes one job at a time and deletes its temporary directory after every result.
