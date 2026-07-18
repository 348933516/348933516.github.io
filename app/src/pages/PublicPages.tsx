import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronRight, Copy, Download, FileImage, FolderOpen, Maximize2, Search, Tag, X } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSiteData } from "../data";
import type { ContentItem } from "../types";

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function cover(item: ContentItem) {
  return item.media.find((media) => media.kind === "image")?.src || "https://images.unsplash.com/photo-1535378620166-273708d44e4c?auto=format&fit=crop&w=1200&q=80";
}

function ContentCard({ item }: { item: ContentItem }) {
  return (
    <article className="content-card">
      <Link className="card-cover" to={`/content/${item.slug}`}><img src={cover(item)} alt={item.title} loading="lazy" /></Link>
      <div className="card-content">
        <div className="card-meta"><span>{item.categoryName}</span><span>{formatDate(item.publishedAt || item.updatedAt)}</span></div>
        <h3><Link to={`/content/${item.slug}`}>{item.title}</Link></h3>
        <p>{item.summary}</p>
        <div className="card-footer"><span><FileImage />{item.media.length} 个媒体</span><Link to={`/content/${item.slug}`}>查看详情<ArrowRight /></Link></div>
      </div>
    </article>
  );
}

export function HomePage() {
  const { settings, categories, contents } = useSiteData();
  const featured = contents.filter((item) => item.featured).slice(0, 4);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  return (
    <>
      <section className="hero-band" style={settings.heroBackgroundUrl ? { backgroundImage: `linear-gradient(90deg, rgba(8,13,16,.9), rgba(8,13,16,.58)), url(${settings.heroBackgroundUrl})` } : undefined}>
        <div className="page-width hero-content">
          {settings.heroLogoUrl && <img className="hero-logo" src={settings.heroLogoUrl} alt="" />}
          <span className="eyebrow">MapleStoryNK Knowledge Base</span>
          <h1>{settings.heroTitle}</h1>
          <p>{settings.heroSubtitle}</p>
          <form className="hero-search" onSubmit={(event) => { event.preventDefault(); if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`); }}>
            <Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入地图、BOSS、WZ 或图片标注" /><button type="submit">搜索资料</button>
          </form>
        </div>
      </section>
      <section className="page-width section-block">
        <div className="section-heading"><div><span>CATALOG</span><h2>{settings.categoryTitle}</h2><p>{settings.categorySubtitle}</p></div></div>
        <div className="category-grid">
          {categories.map((category) => {
            const count = contents.filter((item) => item.categoryId === category.id).length;
            return <Link className="category-entry" key={category.id} to={`/category/${category.slug}`}>
              <div className="category-visual">{category.imageUrl || settings.tileBackgroundUrl ? <img src={category.imageUrl || settings.tileBackgroundUrl} alt="" loading="lazy" /> : <FolderOpen />}</div>
              <div><span>{String(count).padStart(2, "0")} 篇资料</span><h3>{category.name}</h3><p>{category.description}</p></div><ChevronRight />
            </Link>;
          })}
        </div>
      </section>
      {featured.length > 0 && <section className="page-width section-block"><div className="section-heading"><div><span>FEATURED</span><h2>精选资料</h2></div></div><div className="content-list">{featured.map((item) => <ContentCard item={item} key={item.id} />)}</div></section>}
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

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { contents } = useSiteData();
  const query = params.get("q") || "";
  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return contents;
    return contents.filter((item) => [item.title, item.summary, item.bodyText, item.categoryName, item.tags.join(" "), item.media.map((media) => `${media.title} ${media.note}`).join(" ")].join(" ").toLowerCase().includes(keyword));
  }, [contents, query]);
  const [value, setValue] = useState(query);
  return <div className="page-width page-stack"><header className="page-header"><span>SEARCH</span><h1>全站搜索</h1><p>按标题、正文、图片名称、标注、标签和分类查找。</p></header><form className="search-page-form" onSubmit={(event) => { event.preventDefault(); setParams(value.trim() ? { q: value.trim() } : {}); }}><Search /><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="搜索资料" /><button type="submit">搜索</button></form><div className="result-count">{query ? `“${query}” 找到 ${results.length} 条结果` : `全部 ${results.length} 条资料`}</div><div className="content-list">{results.map((item) => <ContentCard item={item} key={item.id} />)}</div></div>;
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
