import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Copy, Download, FileImage, FolderOpen, Maximize2, Tag, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { RichContent, standaloneMedia } from "../components/RichContent";
import { VideoPlayer } from "../components/VideoPlayer";
import { useSiteData } from "../data";
import { normalizeCarouselTarget } from "../lib/carousel";
import { buildShareUrl, copyShareUrl } from "../lib/share";
import { loadPublicCategory, loadPublicContent } from "../lib/repository";
import type { ContentItem, ContentMedia } from "../types";

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function cover(item: ContentItem) {
  return item.media.find((media) => media.kind === "image")?.src || "";
}

function ContentCard({ item }: { item: ContentItem }) {
  return (
    <article className="content-card">
      <Link className="card-cover" to={`/content/${item.slug}`}>{cover(item) ? <img src={cover(item)} alt={item.title} loading="lazy" /> : <span className="media-placeholder"><FileImage /></span>}</Link>
      <div className="card-content">
        <div className="card-meta"><span>{item.categoryName}</span><span>{formatDate(item.publishedAt || item.updatedAt)}</span></div>
        <h3><Link to={`/content/${item.slug}`}>{item.title}</Link></h3>
        <p>{item.summary}</p>
        <div className="card-footer"><span><FileImage />{item.mediaCount ?? item.media.length} 张媒体</span><Link to={`/content/${item.slug}`}>查看详情<ArrowRight /></Link></div>
      </div>
    </article>
  );
}

function VideoMedia({ media }: { media: ContentMedia }) {
  return <div className="media-video-shell"><VideoPlayer media={media} /></div>;
}

function ShareButton({ route }: { route: string }) {
  const [copyState, setCopyState] = useState<"" | "success" | "error">("");
  const copyLink = async () => {
    const copied = await copyShareUrl(buildShareUrl(route));
    setCopyState(copied ? "success" : "error");
    window.setTimeout(() => setCopyState(""), 2400);
  };
  return <div className="share-action"><button className="button quiet" type="button" onClick={copyLink}><Copy />{copyState === "success" ? "已复制" : "复制链接"}</button>{copyState === "error" && <span role="status">复制失败，请复制浏览器地址栏。</span>}</div>;
}

function HomepageCarousel() {
  const { settings, carouselSlides } = useSiteData();
  const slides = useMemo(() => {
    const visible = settings.carouselEnabled ? carouselSlides : [];
    if (visible.length > 0) return visible;
    return [{
      id: "fallback",
      title: settings.heroTitle,
      subtitle: settings.heroSubtitle,
      imageUrl: settings.pageBackgroundUrl || settings.tileBackgroundUrl || "",
      linkUrl: "",
      linkLabel: "",
      sortOrder: 1,
      visible: true,
      createdAt: "",
      updatedAt: ""
    }];
  }, [carouselSlides, settings.carouselEnabled, settings.heroSubtitle, settings.heroTitle, settings.pageBackgroundUrl, settings.tileBackgroundUrl]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    setActive(0);
  }, [slides.length]);

  useEffect(() => {
    if (!settings.carouselAutoplay || paused || reducedMotion || slides.length <= 1) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % slides.length), Math.max(1500, settings.carouselIntervalMs || 4500));
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, settings.carouselAutoplay, settings.carouselIntervalMs, slides.length]);

  const goTo = (index: number) => setActive((index + slides.length) % slides.length);
  const previous = () => goTo(active - 1);
  const next = () => goTo(active + 1);

  return (
    <section className="hero-carousel-band">
      <div className="page-width hero-carousel-shell" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
        <div className={`hero-carousel-frame is-${settings.carouselTransition}`} role="region" aria-roledescription="carousel" aria-label="首页轮播">
          <div className="hero-carousel-track" style={settings.carouselTransition === "slide" ? { transform: `translateX(-${active * 100}%)` } : undefined}>
            {slides.map((slide, index) => (
              <div className={`hero-carousel-slide${index === active ? " active" : ""}`} key={slide.id} aria-hidden={index !== active}>
                {(() => {
                  const image = slide.imageUrl || settings.pageBackgroundUrl || settings.tileBackgroundUrl || "";
                  const target = normalizeCarouselTarget(slide.linkUrl);
                  const overlay = <div className="hero-carousel-overlay"><div><span>MAPLESTORYNK</span><h1>{slide.title}</h1><p>{slide.subtitle}</p></div>{target && <span className="hero-carousel-cta">{slide.linkLabel || "查看详情"}<ChevronRight /></span>}</div>;
                  const priority = index === 0 ? { fetchpriority: "high" } : {};
                  const content = <>{image ? <img className="hero-carousel-image" src={image} alt={slide.title || "轮播图"} loading={index === 0 ? "eager" : "lazy"} decoding="async" {...priority} /> : <div className="hero-carousel-placeholder" />}{overlay}</>;
                  return target
                    ? <Link className="hero-carousel-slide-link" to={target} tabIndex={index === active ? 0 : -1}>{content}</Link>
                    : <div className="hero-carousel-slide-static">{content}</div>;
                })()}
              </div>
            ))}
          </div>
          {slides.length > 1 && <>
            <button className="carousel-arrow left" type="button" onClick={previous} aria-label="上一张"><ChevronLeft /></button>
            <button className="carousel-arrow right" type="button" onClick={next} aria-label="下一张"><ChevronRight /></button>
            <div className="carousel-dots" aria-label="轮播分页">{slides.map((slide, index) => <button key={slide.id} type="button" className={index === active ? "active" : ""} onClick={() => goTo(index)} aria-label={`切换到第 ${index + 1} 张`} />)}</div>
          </>}
        </div>
      </div>
    </section>
  );
}

export function HomePage() {
  const { settings, categories, contents, loading, errorMessage } = useSiteData();
  return (
    <>
      <HomepageCarousel />
      <section className="page-width section-block">
        <div className="section-heading"><div><span>CATALOG</span><h2>{settings.categoryTitle}</h2><p>{settings.categorySubtitle}</p></div></div>
        {errorMessage && <div className="public-inline-error"><strong>资料暂时无法更新</strong><span>{errorMessage}</span></div>}
        {loading && !categories.length && <div className="category-grid public-skeleton-grid">{[1, 2, 3, 4].map((item) => <div className="category-entry public-skeleton" key={item}><span /><div><i /><b /><i /></div></div>)}</div>}
        <div className="category-grid">
          {categories.map((category) => {
            const count = category.contentCount ?? contents.filter((item) => item.categoryId === category.id).length;
            const firstContentImage = contents.find((item) => item.categoryId === category.id && item.media.some((media) => media.kind === "image" && media.src))?.media.find((media) => media.kind === "image" && media.src)?.src;
            const categoryCover = category.imageUrl || settings.tileBackgroundUrl || category.firstMediaUrl || firstContentImage;
            return <Link className="category-entry" key={category.id} to={`/category/${category.slug}`}>
              <div className="category-visual">{categoryCover ? <img src={categoryCover} alt="" loading="lazy" /> : <FolderOpen />}</div>
              <div><span>{String(count).padStart(2, "0")} 篇资料</span><h3>{category.name}</h3><p>{category.description}</p></div><ChevronRight />
            </Link>;
          })}
        </div>
      </section>
    </>
  );
}

export function CategoryPage() {
  const { slug = "" } = useParams();
  const { categories, contents } = useSiteData();
  const [page, setPage] = useState(0);
  const localCategory = categories.find((item) => item.slug === slug);
  const useLocal = contents.some((item) => item.categorySlug === slug);
  const result = useQuery({ queryKey: ["public-category", slug, page], queryFn: () => loadPublicCategory(slug, page * 20, 20), enabled: !useLocal, staleTime: 5 * 60_000 });
  const category = useLocal ? localCategory : result.data?.category;
  const allLocal = useLocal && category ? contents.filter((item) => item.categoryId === category.id).sort((a, b) => a.sortOrder - b.sortOrder) : [];
  const items = useLocal ? allLocal.slice(page * 20, page * 20 + 20) : result.data?.items || [];
  const total = useLocal ? allLocal.length : result.data?.total || 0;
  if (!useLocal && result.isLoading) return <PublicRouteLoading label="正在读取分类资料" />;
  if (result.error) return <PublicRouteError error={result.error} retry={() => result.refetch()} />;
  if (!category) return <NotFoundPage />;
  return <div className="page-width page-stack"><div className="detail-actions"><Link className="back-link" to="/"><ArrowLeft />返回首页</Link><ShareButton route={`/category/${category.slug}`} /></div><header className="page-header"><span>资料类目</span><h1>{category.name}</h1><p>{category.description}</p></header><div className="result-count">共 {total} 篇已发布资料</div><div className="content-list">{items.map((item) => <ContentCard item={item} key={item.id} />)}</div>{total > 20 && <nav className="public-pagination"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft />上一页</button><span>第 {page + 1} 页</span><button disabled={(page + 1) * 20 >= total} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></button></nav>}</div>;
}

export function DetailPage() {
  const { slug = "" } = useParams();
  const { contents } = useSiteData();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const localItem = contents.find((content) => content.slug === slug);
  const result = useQuery({ queryKey: ["public-content", slug], queryFn: () => loadPublicContent(slug), enabled: !localItem, staleTime: 5 * 60_000 });
  const item = localItem || result.data?.item;
  if (!localItem && result.isLoading) return <PublicRouteLoading label="正在读取资料正文" />;
  if (result.error) return <PublicRouteError error={result.error} retry={() => result.refetch()} />;
  if (!item) return <NotFoundPage />;
  const categoryItems = localItem ? contents.filter((content) => content.categoryId === item.categoryId).sort((a, b) => a.sortOrder - b.sortOrder) : result.data?.siblings || [];
  const related = categoryItems.filter((content) => content.id !== item.id).slice(0, 3);
  const position = categoryItems.findIndex((content) => content.id === item.id);
  const previous = position > 0 ? categoryItems[position - 1] : null;
  const next = position >= 0 && position < categoryItems.length - 1 ? categoryItems[position + 1] : null;
  const galleryMedia = standaloneMedia(item.bodyHtml, item.media);
  const outline = galleryMedia.map((media) => media.path).flat().filter((value, index, all) => value && all.indexOf(value) === index);
  return <div className="page-width detail-page">
    <div className="detail-actions"><Link className="back-link" to={`/category/${item.categorySlug}`}><ArrowLeft />返回{item.categoryName}</Link><ShareButton route={`/content/${item.slug}`} /></div>
    <article className="detail-article"><header><span>{item.categoryName}</span><h1>{item.title}</h1><p>{item.summary}</p><div className="detail-meta"><span><CalendarDays />更新于 {formatDate(item.updatedAt)}</span>{item.tags.map((tag) => <span key={tag}><Tag />{tag}</span>)}</div></header>
      <div className={`reader-layout ${outline.length ? "with-outline" : "without-outline"}`}>{outline.length > 0 && <aside className="reader-outline"><strong>图片目录</strong>{outline.map((entry) => <a key={entry} href={`#media-${encodeURIComponent(entry)}`}>{entry}</a>)}</aside>}<div className="reader-main"><RichContent html={item.bodyHtml} />
      {galleryMedia.map((media) => <figure className="media-row" key={media.id} id={`media-${encodeURIComponent(media.path.at(-1) || media.id)}`}>{media.kind === "video" ? <VideoMedia media={media} /> : <button type="button" className="media-image-button" onClick={() => setLightbox(media.src)}><img src={media.src} alt={media.altText || media.title} loading="lazy" /><span><Maximize2 />放大查看</span></button>}<figcaption><small>{media.path.join(" / ")}</small><h2>{media.title}</h2>{media.note && <p>{media.note}</p>}</figcaption></figure>)}
      {item.attachments.length > 0 && <section className="attachment-list"><h2>相关附件</h2>{item.attachments.map((attachment) => <a href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id}><Download /><span><strong>{attachment.name}</strong><small>{attachment.sizeBytes ? `${(attachment.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "下载附件"}</small></span></a>)}</section>}</div></div>
    </article>
    <nav className="previous-next">{previous ? <Link to={`/content/${previous.slug}`}><ArrowLeft /><span>上一篇<strong>{previous.title}</strong></span></Link> : <span />}{next && <Link to={`/content/${next.slug}`}><span>下一篇<strong>{next.title}</strong></span><ArrowRight /></Link>}</nav>
    {related.length > 0 && <section className="related"><div className="section-heading"><div><span>RELATED</span><h2>相关资料</h2></div></div><div className="content-list">{related.map((content) => <ContentCard item={content} key={content.id} />)}</div></section>}
    {lightbox && <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}><button type="button" aria-label="关闭"><X /></button><img src={lightbox} alt="放大预览" /></div>}
  </div>;
}

export function NotFoundPage() {
  return <div className="page-width empty-state"><h1>没有找到这个页面</h1><p>资料可能已移动、隐藏或删除。</p><Link className="button primary" to="/">返回首页</Link></div>;
}

function PublicRouteLoading({ label }: { label: string }) {
  return <div className="page-width public-route-state"><div className="route-skeleton" /><strong>{label}</strong></div>;
}

function PublicRouteError({ error, retry }: { error: unknown; retry(): void }) {
  return <div className="page-width public-route-state error"><strong>资料读取失败</strong><span>{error instanceof Error ? error.message : "请稍后重试"}</span><button className="button quiet" onClick={retry}>重新读取</button></div>;
}
