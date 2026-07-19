import type { User } from "@supabase/supabase-js";
import { publicMediaBucket } from "./config";
import { sanitizeHtml, safeUrl, slugify } from "./sanitize";
import { supabase } from "./supabase";
import type {
  Attachment,
  Category,
  CarouselSlide,
  ContentDraft,
  ContentItem,
  ContentMedia,
  Profile,
  PublicData,
  SiteSettings
} from "../types";

const fallbackSettings: SiteSettings = {
  brandTitle: "MapleStoryNK",
  brandSubtitle: "Content and map knowledge base",
  heroTitle: "MapleStoryNK",
  heroSubtitle: "Maps, WZ business and BOSS pairing information in one place.",
  categoryTitle: "Catalog",
  categorySubtitle: "Pick a category and browse the full set.",
  carouselEnabled: true,
  carouselAutoplay: true,
  carouselIntervalMs: 4500,
  carouselTransition: "slide"
};

function isMissingSchema(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("schema cache")));
}

function storageUrl(bucket?: string | null, path?: string | null, external?: string | null) {
  if (external) return safeUrl(external);
  if (!bucket || !path || bucket !== publicMediaBucket) return "";
  return safeUrl(supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl);
}

function mapSettings(row: Record<string, unknown> | null): SiteSettings {
  if (!row) return fallbackSettings;
  return {
    brandTitle: String(row.brand_title || fallbackSettings.brandTitle),
    brandSubtitle: String(row.brand_subtitle || fallbackSettings.brandSubtitle),
    heroTitle: String(row.hero_title || fallbackSettings.heroTitle),
    heroSubtitle: String(row.hero_subtitle || fallbackSettings.heroSubtitle),
    categoryTitle: String(row.category_title || fallbackSettings.categoryTitle),
    categorySubtitle: String(row.category_subtitle || fallbackSettings.categorySubtitle),
    topLogoUrl: storageUrl(publicMediaBucket, row.top_logo_path as string),
    heroLogoUrl: storageUrl(publicMediaBucket, row.hero_logo_path as string),
    pageBackgroundUrl: storageUrl(publicMediaBucket, row.page_background_path as string),
    tileBackgroundUrl: storageUrl(publicMediaBucket, row.tile_background_path as string),
    carouselEnabled: Boolean(row.carousel_enabled ?? fallbackSettings.carouselEnabled),
    carouselAutoplay: Boolean(row.carousel_autoplay ?? fallbackSettings.carouselAutoplay),
    carouselIntervalMs: Number(row.carousel_interval_ms || fallbackSettings.carouselIntervalMs),
    carouselTransition: row.carousel_transition === "fade" ? "fade" : "slide"
  };
}

function mapMedia(row: Record<string, unknown>): ContentMedia {
  return {
    id: String(row.id),
    kind: row.kind === "video" ? "video" : "image",
    src: storageUrl(row.storage_bucket as string, row.storage_path as string, row.external_url as string),
    title: String(row.title || ""),
    note: String(row.note || ""),
    path: Array.isArray(row.hierarchy_path) ? row.hierarchy_path.map(String) : [],
    altText: String(row.alt_text || row.title || ""),
    sortOrder: Number(row.sort_order || 100),
    width: row.width ? Number(row.width) : undefined,
    height: row.height ? Number(row.height) : undefined
  };
}

function mapAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: String(row.id),
    name: String(row.name || "Attachment"),
    url: storageUrl(row.storage_bucket as string, row.storage_path as string, row.external_url as string),
    mimeType: row.mime_type ? String(row.mime_type) : undefined,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : undefined,
    sortOrder: Number(row.sort_order || 100)
  };
}

function mapCarouselSlide(row: Record<string, unknown>): CarouselSlide {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    subtitle: String(row.subtitle || ""),
    imageUrl: storageUrl(publicMediaBucket, row.image_path as string),
    linkUrl: String(row.link_url || ""),
    linkLabel: String(row.link_label || "View details"),
    sortOrder: Number(row.sort_order || 100),
    visible: Boolean(row.is_visible ?? true),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString())
  };
}

async function adminStorageUrl(bucket?: string | null, path?: string | null, external?: string | null) {
  if (external) return safeUrl(external);
  if (!bucket || !path) return "";
  if (bucket === publicMediaBucket) return storageUrl(bucket, path);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return error ? "" : safeUrl(data.signedUrl);
}

async function loadStructuredPublicData(): Promise<PublicData | null> {
  const [settingsResult, categoriesResult, contentsResult] = await Promise.all([
    supabase.from("site_settings").select("*").eq("id", "main").maybeSingle(),
    supabase.from("categories").select("*").eq("is_visible", true).order("sort_order"),
    supabase.from("published_contents").select("*").order("sort_order")
  ]);
  if ([settingsResult.error, categoriesResult.error, contentsResult.error].some(isMissingSchema)) return null;
  if (settingsResult.error) throw settingsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;
  if (contentsResult.error) throw contentsResult.error;
  if (!settingsResult.data?.migration_completed) return null;

  let carouselRows: Record<string, unknown>[] = [];
  const carouselResult = await supabase.from("carousel_slides").select("*").order("sort_order");
  if (carouselResult.error && !isMissingSchema(carouselResult.error)) throw carouselResult.error;
  if (!carouselResult.error) carouselRows = carouselResult.data || [];

  const contentRows = contentsResult.data || [];
  const contentIds = contentRows.map((row) => row.id);
  const [mediaResult, attachmentsResult, tagsResult] = contentIds.length ? await Promise.all([
    supabase.from("content_media").select("*").in("content_id", contentIds).order("sort_order"),
    supabase.from("attachments").select("*").in("content_id", contentIds).order("sort_order"),
    supabase.from("content_tags").select("content_id, tags(name)").in("content_id", contentIds)
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (mediaResult.error) throw mediaResult.error;
  if (attachmentsResult.error) throw attachmentsResult.error;
  if (tagsResult.error) throw tagsResult.error;

  const mediaByContent = new Map<string, ContentMedia[]>();
  for (const row of mediaResult.data || []) {
    const list = mediaByContent.get(row.content_id) || [];
    list.push(mapMedia(row));
    mediaByContent.set(row.content_id, list);
  }
  const attachmentsByContent = new Map<string, Attachment[]>();
  for (const row of attachmentsResult.data || []) {
    const list = attachmentsByContent.get(row.content_id) || [];
    list.push(mapAttachment(row));
    attachmentsByContent.set(row.content_id, list);
  }
  const tagsByContent = new Map<string, string[]>();
  for (const row of tagsResult.data || []) {
    const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    if (!tag || typeof tag !== "object" || !("name" in tag)) continue;
    tagsByContent.set(row.content_id, [...(tagsByContent.get(row.content_id) || []), String(tag.name)]);
  }

  const categories: Category[] = (categoriesResult.data || []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    imageUrl: storageUrl(publicMediaBucket, row.image_path),
    sortOrder: row.sort_order,
    visible: row.is_visible
  }));
  const contents: ContentItem[] = contentRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    title: row.title,
    summary: row.summary || "",
    bodyHtml: sanitizeHtml(row.body_html),
    bodyJson: {},
    bodyText: row.body_text || "",
    sourceRecord: "",
    status: "published",
    featured: row.is_featured,
    sortOrder: row.sort_order,
    version: row.version,
    tags: tagsByContent.get(row.id) || [],
    media: mediaByContent.get(row.id) || [],
    attachments: attachmentsByContent.get(row.id) || [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  }));
  const carouselSlides = carouselRows.map(mapCarouselSlide).filter((slide) => slide.visible);
  return { settings: mapSettings(settingsResult.data), categories, contents, carouselSlides, backendMode: "structured" };
}

async function loadLegacyPublicData(): Promise<PublicData> {
  const { data, error } = await supabase.from("site_state").select("data").eq("id", "main").maybeSingle();
  if (error) throw error;
  const state = (data?.data || {}) as Record<string, unknown>;
  const names = Array.isArray(state.categories) ? state.categories.map(String) : [];
  const texts = (state.categoryTexts || {}) as Record<string, string>;
  const images = (state.categoryImages || {}) as Record<string, string>;
  const categories: Category[] = names.map((name, index) => ({
    id: `legacy-category-${index}`,
    slug: slugify(name),
    name,
    description: texts[name] || "Category",
    imageUrl: safeUrl(images[name]),
    sortOrder: (index + 1) * 10,
    visible: true
  }));
  const categoryByName = new Map(categories.map((category) => [category.name, category]));
  const rows = Array.isArray(state.contents) ? state.contents as Record<string, unknown>[] : [];
  const contents: ContentItem[] = rows.filter((row) => row.status === "published").map((row, index) => {
    const category = categoryByName.get(String(row.category)) || categories[0];
    const rawMedia = Array.isArray(row.mediaItems) ? row.mediaItems as Record<string, unknown>[] : [];
    const mediaSource: Record<string, unknown>[] = rawMedia.length ? rawMedia : (Array.isArray(row.images) ? row.images : [row.image]).filter(Boolean).map((src) => ({ src }));
    return {
      id: String(row.id || `legacy-${index}`),
      slug: slugify(String(row.id || row.title || `legacy-${index}`)),
      categoryId: category?.id || "legacy-category",
      categorySlug: category?.slug || "legacy",
      categoryName: category?.name || String(row.category || "Content"),
      title: String(row.title || "Untitled"),
      summary: String(row.summary || ""),
      bodyHtml: sanitizeHtml(String(row.bodyHtml || "")),
      bodyJson: {},
      bodyText: String(row.bodyHtml || "").replace(/<[^>]+>/g, " "),
      sourceRecord: "",
      status: "published",
      featured: false,
      sortOrder: Number(row.order || 100),
      version: 1,
      tags: [],
      media: mediaSource.map((media, mediaIndex) => ({
        id: `${row.id || index}-media-${mediaIndex}`,
        kind: "image" as const,
        src: safeUrl(String(media.src || "")),
        title: String(media.title || `Image ${mediaIndex + 1}`),
        note: String(media.note || ""),
        path: String(media.path || row.category || "").split("/").filter(Boolean),
        altText: String(media.title || row.title || "Image"),
        sortOrder: (mediaIndex + 1) * 10
      })).filter((media) => media.src),
      attachments: [],
      createdBy: undefined,
      createdAt: String(row.updatedAt || new Date().toISOString()),
      updatedAt: String(row.updatedAt || new Date().toISOString())
    };
  });
  const appearance = (state.appearance || {}) as Record<string, unknown>;
  const settings: SiteSettings = {
    ...fallbackSettings,
    brandTitle: String(appearance.brandTitle || fallbackSettings.brandTitle),
    brandSubtitle: String(appearance.brandSubtitle || fallbackSettings.brandSubtitle),
    heroTitle: String(appearance.heroTitle || fallbackSettings.heroTitle),
    heroSubtitle: String(appearance.heroSubtitle || fallbackSettings.heroSubtitle),
    categoryTitle: String(appearance.categoryTitle || fallbackSettings.categoryTitle),
    categorySubtitle: String(appearance.categorySubtitle || fallbackSettings.categorySubtitle),
    topLogoUrl: safeUrl(String(appearance.topLogo || "")),
    heroLogoUrl: safeUrl(String(appearance.heroLogo || "")),
    pageBackgroundUrl: safeUrl(String(appearance.pageBg || "")),
    tileBackgroundUrl: safeUrl(String(appearance.tileBg || "")),
    carouselEnabled: fallbackSettings.carouselEnabled,
    carouselAutoplay: fallbackSettings.carouselAutoplay,
    carouselIntervalMs: fallbackSettings.carouselIntervalMs,
    carouselTransition: fallbackSettings.carouselTransition
  };
  return { settings, categories, contents, carouselSlides: [], backendMode: "legacy" };
}

export async function loadPublicData() {
  return (await loadStructuredPublicData()) || loadLegacyPublicData();
}

export async function loadProfile(user: User): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("id, email, display_name, role, status").eq("id", user.id).maybeSingle();
  if (isMissingSchema(error)) return null;
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, email: data.email, displayName: data.display_name, role: data.role, status: data.status };
}

export async function loadAdminContents(): Promise<ContentItem[]> {
  const { data, error } = await supabase.from("contents").select("*, categories!inner(id, slug, name), content_media(*)").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => {
    const category = row.categories as { id: string; slug: string; name: string };
    return {
      id: row.id,
      slug: row.slug,
      categoryId: category.id,
      categorySlug: category.slug,
      categoryName: category.name,
      title: row.title,
      summary: row.summary || "",
      bodyHtml: sanitizeHtml(row.body_html),
      bodyJson: row.body_json || {},
      bodyText: row.body_text || "",
      sourceRecord: row.source_record || "",
      status: row.status,
      featured: row.is_featured,
      sortOrder: row.sort_order,
      version: row.version,
      tags: [],
      media: (row.content_media || []).map(mapMedia),
      attachments: [],
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at
    };
  });
}

export async function loadAdminContent(id: string): Promise<ContentItem> {
  const [contentResult, mediaResult, attachmentResult, tagResult] = await Promise.all([
    supabase.from("contents").select("*, categories!inner(id, slug, name)").eq("id", id).single(),
    supabase.from("content_media").select("*").eq("content_id", id).order("sort_order"),
    supabase.from("attachments").select("*").eq("content_id", id).order("sort_order"),
    supabase.from("content_tags").select("tags(name)").eq("content_id", id)
  ]);
  if (contentResult.error) throw contentResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (attachmentResult.error) throw attachmentResult.error;
  if (tagResult.error) throw tagResult.error;
  const row = contentResult.data;
  const category = row.categories as { id: string; slug: string; name: string };
  return {
    id: row.id,
    slug: row.slug,
    categoryId: category.id,
    categorySlug: category.slug,
    categoryName: category.name,
    title: row.title,
    summary: row.summary || "",
    bodyHtml: sanitizeHtml(row.body_html),
    bodyJson: row.body_json || {},
    bodyText: row.body_text || "",
    sourceRecord: row.source_record || "",
    status: row.status,
    featured: row.is_featured,
    sortOrder: row.sort_order,
    version: row.version,
    tags: (tagResult.data || []).flatMap((entry) => {
      const tag = Array.isArray(entry.tags) ? entry.tags[0] : entry.tags;
      return tag && typeof tag === "object" && "name" in tag ? [String(tag.name)] : [];
    }),
    media: await Promise.all((mediaResult.data || []).map(async (mediaRow) => ({ ...mapMedia(mediaRow), src: await adminStorageUrl(mediaRow.storage_bucket, mediaRow.storage_path, mediaRow.external_url) }))),
    attachments: await Promise.all((attachmentResult.data || []).map(async (attachmentRow) => ({ ...mapAttachment(attachmentRow), url: await adminStorageUrl(attachmentRow.storage_bucket, attachmentRow.storage_path, attachmentRow.external_url) }))),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    publishedAt: row.published_at
  };
}

export async function saveContent(draft: ContentDraft, userId: string) {
  const { data, error } = await supabase.functions.invoke("save-content", {
    body: {
      ...draft,
      slug: draft.slug || slugify(draft.title),
      bodyHtml: sanitizeHtml(draft.bodyHtml),
      userId
    }
  });
  if (error || data?.error) throw new Error(data?.code === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : data?.error || error?.message);
  return data;
}

export async function changeContentStatus(id: string, version: number, status: "draft" | "hidden" | "trashed", userId: string) {
  const { data, error } = await supabase.functions.invoke("save-content", { body: { action: "status", id, version, status, userId } });
  if (error || data?.error) throw new Error(data?.code === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : data?.error || error?.message);
  return data;
}

export async function publishContent(id: string, version: number) {
  const { data, error } = await supabase.functions.invoke("publish-content", { body: { contentId: id, version } });
  if (error || data?.error) throw new Error(data?.code === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : data?.error || error?.message);
  return data;
}

export async function batchContent(items: Array<{ id: string; version: number }>, action: "move" | "draft" | "hidden" | "trashed", categoryId?: string) {
  const { data, error } = await supabase.functions.invoke("batch-content", { body: { items, action, categoryId } });
  if (error || data?.error) throw new Error(data?.error || error?.message);
  return data as { succeeded: number; results: Array<{ id: string; ok: boolean; error?: string }> };
}

export async function duplicateContent(id: string) {
  const { data, error } = await supabase.functions.invoke("duplicate-content", { body: { contentId: id } });
  if (error || data?.error) throw new Error(data?.error || error?.message);
  return data as { id: string; title: string; version: number };
}
