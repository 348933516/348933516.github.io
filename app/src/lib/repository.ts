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
  ContentStatus,
  Profile,
  PublicCategoryData,
  PublicContentData,
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

export const fallbackPublicData: PublicData = {
  settings: fallbackSettings,
  categories: [],
  contents: [],
  carouselSlides: [],
  backendMode: "structured",
  loading: true
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
  const originalPath = row.original_storage_path ? String(row.original_storage_path) : "";
  const variants = Array.isArray(row.image_variants) ? row.image_variants.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const variant = entry as Record<string, unknown>;
    const path = String(variant.path || "");
    if (!path) return [];
    return [{
      key: String(variant.key || variant.width || "preview"),
      src: storageUrl(publicMediaBucket, path),
      width: Number(variant.width || 0),
      height: Number(variant.height || 0),
      mimeType: String(variant.mimeType || variant.mime_type || "image/webp"),
      sizeBytes: Number(variant.sizeBytes || variant.size_bytes || 0)
    }];
  }) : [];
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
    height: row.height ? Number(row.height) : undefined,
    mimeType: row.mime_type ? String(row.mime_type) : undefined,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : undefined,
    durationMs: row.duration_ms ? Number(row.duration_ms) : undefined,
    videoCodec: row.video_codec ? String(row.video_codec) : undefined,
    originalSizeBytes: row.original_size_bytes ? Number(row.original_size_bytes) : undefined,
    processingStatus: row.processing_status ? String(row.processing_status) as ContentMedia["processingStatus"] : undefined,
    originalSrc: originalPath ? storageUrl(publicMediaBucket, originalPath) : undefined,
    imageVariants: variants.length ? variants : undefined,
    videoProvider: row.video_provider === "tencent_vod" ? "tencent_vod" : undefined,
    providerFileId: row.provider_file_id ? String(row.provider_file_id) : undefined,
    providerAppId: row.provider_app_id ? String(row.provider_app_id) : undefined,
    playbackUrl: row.playback_url ? safeUrl(String(row.playback_url)) : undefined,
    posterUrl: row.poster_url ? safeUrl(String(row.poster_url)) : undefined
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

const publicHomeCacheKey = "maplestorynk-public-home-v2";

function missingRpc(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "PGRST202" || error.code === "42883" || error.message?.includes("get_public_")));
}

function cachePublicHome(data: PublicData) {
  try { localStorage.setItem(publicHomeCacheKey, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* cache is optional */ }
}

export function readPublicHomeCache(): PublicData | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(publicHomeCacheKey) || "null");
    if (!cached?.data || Date.now() - Number(cached.savedAt || 0) > 24 * 60 * 60 * 1000) return undefined;
    return cached.data as PublicData;
  } catch { return undefined; }
}

function mapPublicSummary(row: Record<string, unknown>): ContentItem {
  const coverPath = String(row.cover_path || "");
  const media = coverPath ? [{
    id: `cover-${String(row.id)}`,
    kind: "image" as const,
    src: storageUrl(publicMediaBucket, coverPath),
    title: String(row.title || ""),
    note: "",
    path: [],
    altText: String(row.title || ""),
    sortOrder: 0
  }] : [];
  return {
    id: String(row.id), slug: String(row.slug || ""), categoryId: String(row.category_id || ""),
    categorySlug: String(row.category_slug || ""), categoryName: String(row.category_name || ""),
    title: String(row.title || ""), summary: String(row.summary || ""), bodyHtml: "", bodyJson: {}, bodyText: "", sourceRecord: "",
    status: "published", featured: Boolean(row.is_featured), sortOrder: Number(row.sort_order || 100), version: Number(row.version || 1),
    tags: [], media, attachments: [], createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
    publishedAt: row.published_at ? String(row.published_at) : undefined, mediaCount: Number(row.media_count || media.length)
  };
}

export async function loadPublicHome(): Promise<PublicData> {
  const { data, error } = await supabase.rpc("get_public_home");
  if (missingRpc(error)) return loadPublicData();
  if (error) throw error;
  const payload = (data || {}) as Record<string, unknown>;
  const categories = (Array.isArray(payload.categories) ? payload.categories : []).map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      id: String(row.id), slug: String(row.slug), name: String(row.name), description: String(row.description || ""),
      imageUrl: storageUrl(publicMediaBucket, row.image_path as string), sortOrder: Number(row.sort_order || 100), visible: Boolean(row.is_visible),
      contentCount: Number(row.content_count || 0), firstMediaUrl: storageUrl(publicMediaBucket, row.first_media_path as string)
    } satisfies Category;
  });
  const result: PublicData = {
    settings: mapSettings((payload.settings || {}) as Record<string, unknown>), categories, contents: [],
    carouselSlides: (Array.isArray(payload.carousel) ? payload.carousel : []).map((entry) => mapCarouselSlide(entry as Record<string, unknown>)),
    backendMode: "structured"
  };
  cachePublicHome(result);
  return result;
}

export async function loadPublicCategory(slug: string, offset = 0, limit = 20): Promise<PublicCategoryData | null> {
  const { data, error } = await supabase.rpc("get_public_category", { category_slug: slug, page_offset: offset, page_limit: limit });
  if (missingRpc(error)) {
    const legacy = await loadPublicData();
    const category = legacy.categories.find((entry) => entry.slug === slug);
    if (!category) return null;
    const all = legacy.contents.filter((entry) => entry.categoryId === category.id).sort((a, b) => a.sortOrder - b.sortOrder);
    return { category, items: all.slice(offset, offset + limit), total: all.length };
  }
  if (error) throw error;
  const payload = (data || {}) as Record<string, unknown>;
  if (!payload.category) return null;
  const row = payload.category as Record<string, unknown>;
  const category: Category = { id: String(row.id), slug: String(row.slug), name: String(row.name), description: String(row.description || ""), imageUrl: storageUrl(publicMediaBucket, row.image_path as string), sortOrder: Number(row.sort_order || 100), visible: true };
  return { category, items: (Array.isArray(payload.items) ? payload.items : []).map((entry) => mapPublicSummary(entry as Record<string, unknown>)), total: Number(payload.total || 0) };
}

export async function loadPublicContent(slug: string): Promise<PublicContentData | null> {
  const { data, error } = await supabase.rpc("get_public_content", { content_slug: slug });
  if (missingRpc(error)) {
    const legacy = await loadPublicData();
    const item = legacy.contents.find((entry) => entry.slug === slug);
    return item ? { item, siblings: legacy.contents.filter((entry) => entry.categoryId === item.categoryId) } : null;
  }
  if (error) throw error;
  if (!data) return null;
  const payload = data as Record<string, unknown>;
  const row = payload.content as Record<string, unknown>;
  const item: ContentItem = {
    ...mapPublicSummary(row), bodyHtml: sanitizeHtml(String(row.body_html || "")), bodyText: String(row.body_text || ""),
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    media: (Array.isArray(payload.media) ? payload.media : []).map((entry) => mapMedia(entry as Record<string, unknown>)),
    attachments: (Array.isArray(payload.attachments) ? payload.attachments : []).map((entry) => mapAttachment(entry as Record<string, unknown>))
  };
  return { item, siblings: (Array.isArray(payload.siblings) ? payload.siblings : []).map((entry) => mapPublicSummary(entry as Record<string, unknown>)) };
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

async function mapAdminContentListRows(rows: Array<Record<string, unknown>>) {
  return Promise.all(rows.map(async (row) => {
    const categoryName = String(row.category_name || "");
    const cover = row.cover_bucket || row.cover_path || row.cover_external_url
      ? await adminStorageUrl(
          row.cover_bucket ? String(row.cover_bucket) : null,
          row.cover_path ? String(row.cover_path) : null,
          row.cover_external_url ? String(row.cover_external_url) : null
        )
      : "";
    const media = cover ? [{
      id: `cover-${row.id}`,
      kind: "image" as const,
      src: cover,
      title: String(row.title || ""),
      note: "",
      path: [],
      altText: String(row.title || ""),
      sortOrder: 0
    }] : [];
    return {
      id: String(row.id),
      slug: String(row.slug || ""),
      categoryId: String(row.category_id),
      categorySlug: String(row.category_slug || ""),
      categoryName,
      title: String(row.title || ""),
      summary: String(row.summary || ""),
      bodyHtml: "",
      bodyJson: {},
      bodyText: "",
      sourceRecord: "",
      status: row.status as ContentStatus,
      featured: Boolean(row.is_featured),
      sortOrder: Number(row.sort_order || 100),
      version: Number(row.version || 1),
      tags: [],
      media,
      attachments: [],
      mediaCount: Number(row.media_count || 0),
      attachmentCount: Number(row.attachment_count || 0),
      createdBy: row.created_by ? String(row.created_by) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      publishedAt: row.published_at ? String(row.published_at) : undefined
    } satisfies ContentItem;
  }));
}

export async function loadAdminContentList(): Promise<ContentItem[]> {
  const { data, error } = await supabase.from("admin_content_list").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return mapAdminContentListRows((data || []) as Array<Record<string, unknown>>);
}

export async function loadAdminDashboardPending(): Promise<ContentItem[]> {
  const { data, error } = await supabase.from("admin_content_list")
    .select("*")
    .in("status", ["draft", "hidden"])
    .order("updated_at", { ascending: false })
    .limit(6);
  if (error) throw error;
  return mapAdminContentListRows((data || []) as Array<Record<string, unknown>>);
}

export async function loadAdminDashboardSummary(): Promise<{ published: number; draft: number; hidden: number; trashed: number; storageBytes: number }> {
  const { data, error } = await supabase.rpc("get_admin_dashboard_summary");
  if (error) throw error;
  const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    published: Number(value.published || 0),
    draft: Number(value.draft || 0),
    hidden: Number(value.hidden || 0),
    trashed: Number(value.trashed || 0),
    storageBytes: Number(value.storageBytes ?? value.storage_bytes ?? 0)
  };
}

export async function loadAdminContentPage(input: { page: number; pageSize?: number; status?: ContentStatus | "all"; categoryId?: string; query?: string; sort?: "updated" | "title" | "order" }) {
  const pageSize = Math.min(50, Math.max(1, input.pageSize || 20));
  const page = Math.max(1, input.page || 1);
  let request = supabase.from("admin_content_list").select("*", { count: "exact" });
  if (input.status && input.status !== "all") request = request.eq("status", input.status);
  if (input.categoryId && input.categoryId !== "all") request = request.eq("category_id", input.categoryId);
  const search = (input.query || "").trim().replace(/[%_,().]/g, " ").replace(/\s+/g, " ");
  if (search) request = request.or(`title.ilike.%${search}%,summary.ilike.%${search}%,category_name.ilike.%${search}%`);
  if (input.sort === "title") request = request.order("title", { ascending: true });
  else if (input.sort === "order") request = request.order("sort_order", { ascending: true }).order("updated_at", { ascending: false });
  else request = request.order("updated_at", { ascending: false });
  const from = (page - 1) * pageSize;
  const { data, error, count } = await request.range(from, from + pageSize - 1);
  if (error) throw error;
  return { items: await mapAdminContentListRows((data || []) as Array<Record<string, unknown>>), total: count || 0 };
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

export interface DocumentImportAsset {
  mediaId: string;
  imageIndex: number;
  originalPath: string;
  displayPath: string;
  hash: string;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  displaySize: number;
  imageVariants?: Array<{ key: string; path: string; width: number; height: number; mimeType: string; sizeBytes: number }>;
  sortOrder: number;
  title: string;
  altText: string;
}

export interface DocumentImportJob {
  id: string;
  uploadPrefix: string;
}

export interface DocumentImportListItem {
  id: string;
  content_id: string;
  created_by: string;
  status: "uploading" | "completed" | "failed" | "cancelled";
  expected_images: number;
  total_original_bytes: number;
  source_file_name?: string | null;
  source_file_size?: number | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentImportStatus {
  job: { id: string; status: "uploading" | "completed" | "failed" | "cancelled"; expectedImages: number; sourceFileName?: string | null; sourceFileSize?: number | null; errorMessage?: string | null };
  assets: DocumentImportStatusAsset[];
  events: Array<{ id: number; image_index?: number | null; severity: "info" | "warning" | "error"; phase: string; message: string; bytes_total?: number | null; bytes_uploaded?: number | null; retry_count?: number; http_status?: number | null; error_code?: string | null; elapsed_ms?: number | null; details?: Record<string, unknown>; created_at: string }>;
}

export interface DocumentImportStatusAsset {
  image_index: number;
  media_id: string;
  display_path: string;
  original_path: string;
  sort_order: number;
  image_variants?: Array<{ key: string; path: string; width: number; height: number; mimeType: string; sizeBytes: number }>;
}

export type DocumentImportStage = "start" | "list" | "register" | "status" | "retry" | "event" | "finalize" | "fail" | "cancel";

export class DocumentImportError extends Error {
  readonly stage: DocumentImportStage;
  readonly status: number | null;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(input: { stage: DocumentImportStage; message: string; status?: number | null; code?: string | null; details?: Record<string, unknown> }) {
    super(input.message);
    this.name = "DocumentImportError";
    this.stage = input.stage;
    this.status = input.status ?? null;
    this.code = input.code ?? null;
    this.details = input.details ?? {};
  }
}

async function functionErrorPayload(error: unknown) {
  const context = error && typeof error === "object" && "context" in error ? (error as { context?: unknown }).context : null;
  if (!(context instanceof Response)) return { status: null, payload: {} as Record<string, unknown> };
  let payload: Record<string, unknown> = {};
  try {
    const parsed = await context.clone().json();
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch {
    try { payload = { error: (await context.clone().text()).slice(0, 1000) }; } catch { /* Keep the transport error below. */ }
  }
  return { status: context.status || null, payload };
}

async function invokeDocumentImport<T>(body: Record<string, unknown>) {
  const stage = body.action === "finalize" ? "finalize" : body.action === "register" ? "register" : body.action === "status" ? "status" : body.action === "retry" ? "retry" : body.action === "event" ? "event" : body.action === "list" ? "list" : body.action === "cancel" ? "cancel" : body.action === "fail" ? "fail" : "start";
  const { data, error } = await supabase.functions.invoke("document-import", { body });
  if (error || data?.error) {
    const response = error ? await functionErrorPayload(error) : { status: null, payload: {} as Record<string, unknown> };
    const payload = { ...response.payload, ...(data && typeof data === "object" ? data as Record<string, unknown> : {}) };
    const code = typeof payload.code === "string" ? payload.code : null;
    const summary = code === "VERSION_CONFLICT"
      ? "VERSION_CONFLICT"
      : typeof payload.error === "string" && payload.error.trim()
        ? payload.error
        : error?.message || "Document import failed";
    const databaseError = typeof payload.database_error === "string" ? payload.database_error.trim().slice(0, 1000) : "";
    const message = databaseError && !summary.includes(databaseError) ? `${summary}（数据库：${databaseError}）` : summary;
    throw new DocumentImportError({ stage, message, status: response.status, code, details: payload });
  }
  return data as T;
}

export function startDocumentImport(input: { contentId: string; expectedVersion: number; expectedImages: number; totalOriginalBytes: number; sourceFileName?: string; sourceFileSize?: number }) {
  return invokeDocumentImport<DocumentImportJob>({ action: "start", ...input });
}

export function registerDocumentImportAsset(importId: string, asset: DocumentImportAsset) {
  return invokeDocumentImport<{ registered_assets: number }>({ action: "register", importId, asset });
}

export async function getDocumentImportStatus(importId: string) {
  const status = await invokeDocumentImport<unknown>({ action: "status", importId });
  return normalizeDocumentImportStatus(status, importId);
}

function normalizeDocumentImportStatus(value: unknown, importId: string): DocumentImportStatus {
  if (!value || typeof value !== "object") throw invalidDocumentImportManifest(importId, []);
  const status = value as Record<string, unknown>;
  const rawAssets = Array.isArray(status.assets) ? status.assets : [];
  const invalidAssetIndexes: number[] = [];
  const assets = rawAssets.map((value, offset) => {
    const asset = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const imageIndex = Number(asset.image_index ?? asset.imageIndex);
    const mediaId = String(asset.media_id ?? asset.mediaId ?? "").trim();
    const displayPath = String(asset.display_path ?? asset.displayPath ?? "").trim();
    const originalPath = String(asset.original_path ?? asset.originalPath ?? "").trim();
    const sortOrder = Number(asset.sort_order ?? asset.sortOrder);
    const imageVariants = Array.isArray(asset.image_variants ?? asset.imageVariants) ? (asset.image_variants ?? asset.imageVariants) as DocumentImportStatusAsset["image_variants"] : [];
    if (!Number.isInteger(imageIndex) || imageIndex < 1 || !mediaId || !displayPath || !originalPath || !Number.isFinite(sortOrder)) {
      invalidAssetIndexes.push(Number.isInteger(imageIndex) && imageIndex > 0 ? imageIndex : offset + 1);
    }
    return {
      image_index: imageIndex,
      media_id: mediaId,
      display_path: displayPath,
      original_path: originalPath,
      sort_order: sortOrder,
      image_variants: imageVariants
    };
  });
  if (invalidAssetIndexes.length) throw invalidDocumentImportManifest(importId, invalidAssetIndexes);
  return {
    job: status.job as DocumentImportStatus["job"],
    assets,
    events: Array.isArray(status.events) ? status.events as DocumentImportStatus["events"] : []
  };
}

function invalidDocumentImportManifest(importId: string, invalidAssetIndexes: number[]) {
  return new DocumentImportError({
    stage: "status",
    code: "IMPORT_MANIFEST_INVALID",
    message: "导入任务返回的图片清单格式无效。图片已保留，请刷新页面后继续导入，不要重新创建任务。",
    details: { import_id: importId, invalid_asset_indexes: invalidAssetIndexes.slice(0, 20) }
  });
}

export function listDocumentImports() {
  return invokeDocumentImport<{ jobs: DocumentImportListItem[] }>({ action: "list" });
}

export function retryDocumentImport(importId: string) {
  return invokeDocumentImport<{ ok: boolean; registered_assets: number }>({ action: "retry", importId });
}

export function logDocumentImportEvent(importId: string, event: Record<string, unknown>) {
  return invokeDocumentImport<{ ok: boolean }>({ action: "event", importId, event });
}

export function finalizeDocumentImport(input: { importId: string; expectedVersion: number; bodyHtml: string; sourceRecord: string }) {
  return invokeDocumentImport<{ content_id: string; version: number; imported_images: number }>({ action: "finalize", ...input });
}

export function cancelDocumentImport(importId: string, assets: DocumentImportAsset[], error?: string) {
  return invokeDocumentImport<{ ok: boolean }>({ action: error ? "fail" : "cancel", importId, manifest: assets, error });
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

export async function deleteContentForever(items: Array<{ id: string; version: number }>) {
  const { data, error } = await supabase.functions.invoke("delete-content", { body: { items } });
  if (error || data?.error) throw new Error(data?.error || error?.message);
  return data as { succeeded: number; results: Array<{ id: string; ok: boolean; error?: string }>; storageWarnings?: string[] };
}
