# Tencent COS + EdgeOne rollout

COS must remain disabled until every item in this document is complete. Permanent Tencent credentials must never be added to a `VITE_*` variable or committed file.

## Buckets

- Region: `ap-guangzhou`
- Published bucket: `maplestorynk-media-1331200863`
- Private staging bucket: `maplestorynk-private-1331200863`
- Both buckets: private read/write and SSE-COS enabled
- EdgeOne media domain: `https://media.maplestorynk.online`
- EdgeOne origin: the published COS bucket with private-origin authorization

Apply this CORS policy to both buckets:

- Origins: `https://maplestorynk.online`, `https://www.maplestorynk.online`, `https://348933516.github.io`, `http://127.0.0.1:5173`
- Methods: `GET`, `HEAD`, `PUT`, `POST`, `DELETE`
- Allowed headers: `*`
- Exposed headers: `ETag`, `Content-Length`, `x-cos-request-id`
- Max age: `600`

## CAM account

Create a dedicated API-only CAM sub-account without console login. Restrict it to these two bucket resources:

```text
qcs::cos:ap-guangzhou:uid/1331200863:maplestorynk-media-1331200863/*
qcs::cos:ap-guangzhou:uid/1331200863:maplestorynk-private-1331200863/*
```

The COS resource `uid` is the COS APPID, not the CAM main-account ID. Required COS actions are object read/head, upload, multipart upload, copy and delete. Attach Tencent's managed `QcloudSTSFullAccess` policy so the Edge Function can issue 30-minute path-scoped browser credentials; `name/sts:GetFederationToken` is not a valid action inside a custom COS policy. Do not grant bucket policy, CAM administration or console access.

## Secrets

Set the following in both GitHub Actions secrets and Supabase Edge Function secrets:

```text
TENCENT_COS_SECRET_ID
TENCENT_COS_SECRET_KEY
TENCENT_COS_UIN=1331200863
TENCENT_COS_APP_ID=1331200863
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_PUBLIC_BUCKET=maplestorynk-media-1331200863
TENCENT_COS_PRIVATE_BUCKET=maplestorynk-private-1331200863
TENCENT_MEDIA_BASE_URL=https://media.maplestorynk.online
```

The frontend receives only these non-sensitive values:

```text
VITE_COS_ENABLED=1
VITE_COS_REGION=ap-guangzhou
VITE_COS_PUBLIC_BUCKET=maplestorynk-media-1331200863
VITE_COS_PRIVATE_BUCKET=maplestorynk-private-1331200863
VITE_MEDIA_BASE_URL=https://media.maplestorynk.online
```

## Rollout order

1. Create and verify the private bucket and CAM account.
2. Add secrets, apply `20260729010000_tencent_cos_storage.sql`, and deploy the COS Edge Functions.
3. Enable COS only in `/preview/`.
4. Upload one small image, publish it, and verify the public URL, private cleanup and database provider.
5. Import `C:\Users\8\Desktop\定制地图展示.docx` and verify 98 originals plus 196 previews.
6. Run `日志中心 -> 存储迁移`; do not interrupt the database commit step.
7. Verify all objects through EdgeOne, including video Range `206`, before syncing the formal root build.

The migration task verifies COS object size and EdgeOne accessibility before database cutover. Supabase originals are deleted only after the cutover succeeds. A failed cleanup remains retryable.
