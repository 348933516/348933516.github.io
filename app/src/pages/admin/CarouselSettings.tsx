import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImagePlus, LoaderCircle, Plus, Save, Trash2, Upload } from "lucide-react";
import { publicMediaBucket } from "../../lib/config";
import { randomId } from "../../lib/id";
import { normalizeCarouselTarget } from "../../lib/carousel";
import { imageToWebp, uploadWithProgress } from "../../lib/uploads";
import { supabase } from "../../lib/supabase";
import { AdminLoading, messageOf, publicAssetUrl } from "./shared";
import type { Profile } from "../../types";

type CarouselRow = {
  id: string;
  title: string;
  subtitle: string;
  image_path: string | null;
  link_url: string;
  link_label: string;
  sort_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
};

export function CarouselSettings({
  profile,
  settings,
  onMessage,
  onSaved
}: {
  profile: Profile;
  settings: Record<string, unknown>;
  onMessage(value: string, error?: boolean): void;
  onSaved(): void;
}) {
  const client = useQueryClient();
  const slides = useQuery({
    queryKey: ["carousel-slides"],
    queryFn: async () => {
      const { data, error } = await supabase.from("carousel_slides").select("*").order("sort_order");
      if (error) throw error;
      return (data || []) as CarouselRow[];
    }
  });
  const [saving, setSaving] = useState(false);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const { error } = await supabase.from("site_settings").update({
      carousel_enabled: form.get("carouselEnabled") === "on",
      carousel_autoplay: form.get("carouselAutoplay") === "on",
      carousel_interval_ms: Number(form.get("carouselInterval") || 4500),
      carousel_transition: String(form.get("carouselTransition") || "slide"),
      updated_by: profile.id
    }).eq("id", "main");
    setSaving(false);
    if (error) onMessage(error.message, true);
    else { onMessage("轮播设置已保存。"); onSaved(); }
  };

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["carousel-slides"] });
    onSaved();
  };

  const slideRows = slides.data || [];
  const slideError = slides.error ? messageOf(slides.error) : "";

  return <div className="carousel-settings-stack">
    <section className="admin-panel settings-section">
      <div className="panel-heading"><div><h2>轮播设置</h2><p>控制首页轮播是否启用、自动播放和切换节奏。</p></div></div>
      <form className="carousel-settings-form" onSubmit={saveSettings}>
        <label className="checkbox"><input type="checkbox" name="carouselEnabled" defaultChecked={Boolean(settings.carousel_enabled ?? true)} />启用轮播</label>
        <label className="checkbox"><input type="checkbox" name="carouselAutoplay" defaultChecked={Boolean(settings.carousel_autoplay ?? true)} />自动播放</label>
        <label>切换间隔（毫秒）<input name="carouselInterval" type="number" min="1500" step="100" defaultValue={Number(settings.carousel_interval_ms || 4500)} /></label>
        <label>切换方式<select name="carouselTransition" defaultValue={String(settings.carousel_transition || "slide")}><option value="slide">滑动</option><option value="fade">淡入淡出</option></select></label>
        <button className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />}保存轮播设置</button>
      </form>
    </section>

    <section className="admin-panel settings-section">
      <div className="panel-heading">
        <div><h2>轮播内容</h2><p>可新增、替换、排序和删除轮播图片。</p></div>
        <button className="button primary" type="button" onClick={() => document.getElementById("carousel-create-form")?.scrollIntoView({ behavior: "smooth" })}><Plus />新增轮播</button>
      </div>
      {slideError && <div className="admin-inline-alert error"><div><strong>轮播图读取失败</strong><span>{slideError}</span></div><button className="button quiet" type="button" onClick={() => slides.refetch()}>重新读取</button></div>}
      {slides.isLoading && <AdminLoading label="正在读取轮播图" />}
      <CarouselCreator slides={slideRows} onSaved={refresh} onMessage={onMessage} actorId={profile.id} />
      <div className="carousel-slide-list">
        {slideRows.map((slide, index) => <CarouselSlideRow key={slide.id} slide={slide} index={index} total={slideRows.length} onSaved={refresh} onMessage={onMessage} actorId={profile.id} />)}
        {!slideRows.length && !slideError && !slides.isLoading && <div className="admin-empty"><ImagePlus /><strong>还没有轮播图</strong><span>先新增一张首页轮播图。</span></div>}
      </div>
    </section>
  </div>;
}

function CarouselCreator({ slides, onSaved, onMessage, actorId }: { slides: CarouselRow[]; onSaved(): void; onMessage(value: string, error?: boolean): void; actorId: string }) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("查看详情");
  const [imagePath, setImagePath] = useState("");
  const [visible, setVisible] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  const upload = async (file: File) => {
    try {
      setUploading(true);
      const prepared = await imageToWebp(file);
      const path = `carousel/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      await uploadWithProgress(prepared, path, (value) => setProgress(value.percent), undefined, publicMediaBucket);
      setImagePath(path);
      onMessage("轮播图片已上传，点击创建即可保存。");
    } catch (error) {
      onMessage(messageOf(error, "轮播图片上传失败"), true);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLink = normalizeCarouselTarget(linkUrl.trim());
    if (linkUrl.trim() && !normalizedLink) {
      onMessage("轮播链接只能指向站内内容页或分类页，例如 /content/xxx 或 /category/xxx。", true);
      return;
    }
    if (!imagePath) {
      onMessage("请先上传轮播图片。", true);
      return;
    }
    setSaving(true);
    const nextOrder = (slides[slides.length - 1]?.sort_order || 0) + 10;
    const { error } = await supabase.from("carousel_slides").insert({
      title: title.trim(),
      subtitle: subtitle.trim(),
      image_path: imagePath,
      link_url: normalizedLink,
      link_label: linkLabel.trim() || "查看详情",
      sort_order: nextOrder,
      is_visible: visible,
      created_by: actorId,
      updated_by: actorId
    });
    setSaving(false);
    if (error) {
      onMessage(error.message, true);
      return;
    }
    setTitle("");
    setSubtitle("");
    setLinkUrl("");
    setLinkLabel("查看详情");
    setImagePath("");
    setVisible(true);
    onMessage("轮播图已创建。");
    onSaved();
  };

  return <form className="carousel-create-form" id="carousel-create-form" onSubmit={create}>
    <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="轮播标题" /></label>
    <label>说明<textarea value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="轮播说明" /></label>
    <label>跳转链接<input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="/content/xxx 或 /category/xxx" /></label>
    <label>按钮文案<input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="查看详情" /></label>
    <label className="checkbox"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />显示轮播</label>
    <div className="carousel-upload-box">{imagePath ? <img src={publicAssetUrl(imagePath)} alt="" /> : <span><ImagePlus /><strong>未上传图片</strong></span>}</div>
    <label className="button quiet upload-button"><Upload />{uploading ? `上传中 ${progress}%` : "上传图片"}<input type="file" accept="image/*" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /></label>
    <button className="button primary" disabled={saving || !imagePath}>{saving ? <LoaderCircle className="spin" /> : <Plus />}创建轮播</button>
  </form>;
}

function CarouselSlideRow({
  slide,
  index,
  total,
  onSaved,
  onMessage,
  actorId
}: {
  slide: CarouselRow;
  index: number;
  total: number;
  onSaved(): void;
  onMessage(value: string, error?: boolean): void;
  actorId: string;
}) {
  const [title, setTitle] = useState(slide.title);
  const [subtitle, setSubtitle] = useState(slide.subtitle);
  const [linkUrl, setLinkUrl] = useState(slide.link_url);
  const [linkLabel, setLinkLabel] = useState(slide.link_label || "查看详情");
  const [imagePath, setImagePath] = useState(slide.image_path || "");
  const [visible, setVisible] = useState(Boolean(slide.is_visible));
  const [sortOrder, setSortOrder] = useState(slide.sort_order);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const upload = async (file: File) => {
    try {
      setUploading(true);
      const prepared = await imageToWebp(file);
      const path = `carousel/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      await uploadWithProgress(prepared, path, (value) => setProgress(value.percent), undefined, publicMediaBucket);
      setImagePath(path);
      onMessage("轮播图片已替换，保存后生效。");
    } catch (error) {
      onMessage(messageOf(error, "轮播图片上传失败"), true);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const save = async () => {
    const normalizedLink = normalizeCarouselTarget(linkUrl.trim());
    if (linkUrl.trim() && !normalizedLink) {
      onMessage("轮播链接只能指向站内内容页或分类页，例如 /content/xxx 或 /category/xxx。", true);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("carousel_slides").update({
      title: title.trim(),
      subtitle: subtitle.trim(),
      image_path: imagePath || null,
      link_url: normalizedLink,
      link_label: linkLabel.trim() || "查看详情",
      sort_order: sortOrder,
      is_visible: visible,
      updated_by: actorId
    }).eq("id", slide.id);
    setSaving(false);
    if (error) onMessage(error.message, true);
    else { onMessage("轮播图已保存。"); onSaved(); }
  };

  const move = async (direction: -1 | 1) => {
    const { error } = await supabase.from("carousel_slides").update({ sort_order: slide.sort_order + direction * 10, updated_by: actorId }).eq("id", slide.id);
    if (error) onMessage(error.message, true);
    else onSaved();
  };

  const remove = async () => {
    if (!window.confirm("确定删除这张轮播图吗？")) return;
    const { error } = await supabase.from("carousel_slides").delete().eq("id", slide.id);
    if (error) onMessage(error.message, true);
    else { onMessage("轮播图已删除。"); onSaved(); }
  };

  const preview = imagePath ? publicAssetUrl(imagePath) : "";

  return <article className="carousel-slide-row">
    <div className="carousel-slide-preview">{preview ? <img src={preview} alt="" /> : <span><ImagePlus /></span>}</div>
    <div className="carousel-slide-fields">
      <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>说明<textarea value={subtitle} onChange={(event) => setSubtitle(event.target.value)} /></label>
      <label>跳转链接<input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="/content/xxx 或 /category/xxx" /></label>
      <label>按钮文案<input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} /></label>
      <label>排序<input type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} /></label>
      <label className="checkbox"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />显示</label>
      <div className="carousel-slide-actions">
        <button type="button" className="button quiet" onClick={() => move(-1)} disabled={index === 0}><ArrowUp />上移</button>
        <button type="button" className="button quiet" onClick={() => move(1)} disabled={index === total - 1}><ArrowDown />下移</button>
        <label className="button quiet upload-button"><Upload />{uploading ? `上传中 ${progress}%` : "替换图片"}<input type="file" accept="image/*" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /></label>
        <button type="button" className="button primary" onClick={save} disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />}保存</button>
        <button type="button" className="icon-only danger" onClick={remove} aria-label="删除轮播"><Trash2 /></button>
      </div>
    </div>
  </article>;
}
