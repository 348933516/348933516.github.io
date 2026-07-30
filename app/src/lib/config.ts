export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://edznwgvyqpsibnkqqeby.supabase.co";
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_kuMMovS2ZpF7w9lkiK86Ww_VKkgdgao";
export const publicMediaBucket = "maplestorynk-public";
export const privateMediaBucket = "maplestorynk-private";
export const cosRegion = import.meta.env.VITE_COS_REGION || "ap-guangzhou";
export const cosPublicBucket = import.meta.env.VITE_COS_PUBLIC_BUCKET || "maplestorynk-media-1331200863";
export const cosPrivateBucket = import.meta.env.VITE_COS_PRIVATE_BUCKET || "maplestorynk-private-1331200863";
export const mediaBaseUrl = (import.meta.env.VITE_MEDIA_BASE_URL || "https://media.maplestorynk.online").replace(/\/$/, "");
// COS is the production storage path. Set VITE_COS_ENABLED=0 only for an
// explicit local fallback test; published builds must never silently revert.
export const cosStorageEnabled = import.meta.env.VITE_COS_ENABLED !== "0";

export const cosPublicStorageAlias = "tencent-cos-public";
export const cosPrivateStorageAlias = "tencent-cos-private";
