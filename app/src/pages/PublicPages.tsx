import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Copy, Download, FileImage, FolderOpen, Maximize2, Tag, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useSiteData } from "../data";
import type { ContentItem } from "../types";

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
        <div className="card-footer"><span><FileImage />{item.media.length} 张媒体</span><Link to={`/content/${item.slug}`}>查看详情<ArrowRight /></Link></div>
      </div>
    </article>
  );
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
        <div className="hero-carousel-frame" role="region" aria-roledescription="carousel" aria-label="首页轮播">
          <div className="hero-carousel-track" style={{ transform: `translateX(-${active * 100}%)` }}>
            {slides.map((slide, index) => (
              <div className="hero-carousel-slide" key={slide.id}>
                {(() => {
                  const image = slide.imageUrl || settings.pageBackgroundUrl || settings.tileBackgroundUrl || "";
                  const overlay = <div className="hero-carousel-overlay"><div><span>MAPLESTORYNK</span><h1>{slide.title}</h1><p>{slide.subtitle}</p></div>{slide.linkUrl && <span className="hero-carousel-cta">{slide.linkLabel || "查看详情"}<ChevronRight /></span>}</div>;
                  if (!image) return <div className="hero-carousel-placeholder">{overlay}</div>;
                  return slide.linkUrl ? (
                    <a href={slide.linkUrl} target={slide.linkUrl.startsWith("/") ? "_self" : "_blank"} rel={slide.linkUrl.startsWith("/") ? undefined : "noreferrer"}>
                      <img className="hero-carousel-image" src={image} alt={slide.title || "轮播图"} loading={index === 0 ? "eager" : "lazy"} />
                      {overlay}
                    </a>
                  ) : (
                    <>
                      <img className="hero-carousel-image" src={image} alt={slide.title || "轮播图"} loading={index === 0 ? "eager" : "lazy"} />
                      {overlay}
                    </>
                  );
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
  const { settings, categories, contents } = useSiteData();
  return (
    <>
      <HomepageCarousel />
      <section className="page-width section-block">
        <div className="section-heading"><div><span>CATALOG</span><h2>{settings.categoryTitle}</h2><p>{settings.categorySubtitle}</p></div></div>
        <div className="category-grid">
          {categories.map((category) => {
            const count = contents.filter((item) => item.categoryId === category.id).length;
            const firstContentImage = contents.find((item) => item.categoryId === category.id && item.media.some((media) => media.kind === "image" && media.src))?.media.find((media) => media.kind === "image" && media.src)?.src;
            const categoryCover = category.imageUrl || settings.tileBackgroundUrl || firstContentImage;
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
  const category = categories.find((item) => item.slug === slug);
  if (!category) return <NotFoundPage />;
  const items = contents.filter((item) => item.categoryId === category.id).sort((a, b) => a.sortOrder - b.sortOrder);
  return <div className="page-width page-stack"><Link className="back-link" to="/"><ArrowLeft />返回首页</Link><header className="page-header"><span>资料类目</span><h1>{category.name}</h1><p>{category.description}</p></header><div className="result-count">共 {items.length} 篇已发布资料</div><div className="content-list">{items.map((item) => <ContentCard item={item} key={item.id} />)}</div></div>;
}

export function DetailPage() {
  const { slug = "" } = useParams();
  const { contents } = useSiteData();
  const item = contents.find((content) => content.slug === slug);
  const [lightbox, setLightbox] = useState<string | null>(null);
  if (!item) return <NotFoundPage />;
  const related = contents.filter((content) => content.id !== item.id && content.categoryId === item.categoryId).slice(0, 3);
  const categoryItems = contents.filter((content) => content.categoryId === item.categoryId).sort((a, b) => a.sortOrder - b.sortOrder);
  const position = categoryItems.findIndex((content) => content.id === item.id);
  const previous = position > 0 ? categoryItems[position - 1] : null;
  const next = position >= 0 && position < categoryItems.length - 1 ? categoryItems[position + 1] : null;
  const outline = item.media.map((media) => media.path).flat().filter((value, index, all) => value && all.indexOf(value) === index);
  return <div className="page-width detail-page">
    <div className="detail-actions"><Link className="back-link" to={`/category/${item.categorySlug}`}><ArrowLeft />返回{item.categoryName}</Link><button className="button quiet" type="button" onClick={() => navigator.clipboard.writeText(window.location.href)}><Copy />复制链接</button></div>
    <article className="detail-article"><header><span>{item.categoryName}</span><h1>{item.title}</h1><p>{item.summary}</p><div className="detail-meta"><span><CalendarDays />更新于 {formatDate(item.updatedAt)}</span>{item.tags.map((tag) => <span key={tag}><Tag />{tag}</span>)}</div></header>
      <div className="reader-layout">{outline.length > 0 && <aside className="reader-outline"><strong>图片目录</strong>{outline.map((entry) => <a key={entry} href={`#media-${encodeURIComponent(entry)}`}>{entry}</a>)}</aside>}<div className="reader-main"><div className="reader-body" dangerouslySetInnerHTML={{ __html: item.bodyHtml }} />
      {item.media.map((media) => <figure className="media-row" key={media.id} id={`media-${encodeURIComponent(media.path.at(-1) || media.id)}`}>{media.kind === "video" ? <video controls preload="metadata" src={media.src} /> : <button type="button" className="media-image-button" onClick={() => setLightbox(media.src)}><img src={media.src} alt={media.altText || media.title} loading="lazy" /><span><Maximize2 />放大查看</span></button>}<figcaption><small>{media.path.join(" / ")}</small><h2>{media.title}</h2>{media.note && <p>{media.note}</p>}</figcaption></figure>)}
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
