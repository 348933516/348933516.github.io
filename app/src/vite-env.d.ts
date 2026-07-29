/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COS_ENABLED?: string;
  readonly VITE_COS_REGION?: string;
  readonly VITE_COS_PUBLIC_BUCKET?: string;
  readonly VITE_COS_PRIVATE_BUCKET?: string;
  readonly VITE_MEDIA_BASE_URL?: string;
}
