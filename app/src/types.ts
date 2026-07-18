export type AppRole = "super_admin" | "editor" | "uploader" | "viewer";
export type ProfileStatus = "invited" | "active" | "disabled";
export type ContentStatus = "draft" | "published" | "hidden" | "trashed";

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  status: ProfileStatus;
}

export interface SiteSettings {
  brandTitle: string;
  brandSubtitle: string;
  heroTitle: string;
  heroSubtitle: string;
  categoryTitle: string;
  categorySubtitle: string;
  topLogoUrl?: string;
  heroLogoUrl?: string;
  pageBackgroundUrl?: string;
  tileBackgroundUrl?: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl?: string;
  sortOrder: number;
  visible: boolean;
}

export interface ContentMedia {
  id: string;
  kind: "image" | "video";
  src: string;
  title: string;
  note: string;
  path: string[];
  altText: string;
  sortOrder: number;
  width?: number;
  height?: number;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  sortOrder: number;
}

export interface ContentItem {
  id: string;
  slug: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  title: string;
  summary: string;
  bodyHtml: string;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  sourceRecord: string;
  status: ContentStatus;
  featured: boolean;
  sortOrder: number;
  version: number;
  tags: string[];
  media: ContentMedia[];
  attachments: Attachment[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface PublicData {
  settings: SiteSettings;
  categories: Category[];
  contents: ContentItem[];
  backendMode: "structured" | "legacy";
}

export interface ContentDraft {
  id?: string;
  slug: string;
  categoryId: string;
  title: string;
  summary: string;
  bodyHtml: string;
  bodyJson: Record<string, unknown>;
  bodyText: string;
  sourceRecord: string;
  status: ContentStatus;
  featured: boolean;
  sortOrder: number;
  version?: number;
  tags: string[];
}
