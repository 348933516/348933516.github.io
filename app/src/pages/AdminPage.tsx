import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Ban, Check, Database,
  FilePenLine, FileText, FolderTree, Gauge, History, ImagePlus, Link2, LoaderCircle,
  LogOut, Menu, Plus, RotateCcw, Save, Search, Settings, ShieldCheck, Trash2,
  Upload, UserPlus, Users, X
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { RichEditor } from "../components/RichEditor";
import { useSiteData } from "../data";
import { publicMediaBucket } from "../lib/config";
import { readDocument, readWebPage } from "../lib/documents";
import { changeContentStatus, loadAdminContents, publishContent, saveContent } from "../lib/repository";
import { slugify } from "../lib/sanitize";
import { supabase } from "../lib/supabase";
import { imageDimensions, imageToWebp, uploadWithProgress, validateUpload } from "../lib/uploads";
import type { AppRole, Category, ContentDraft, ContentItem, ContentStatus, Profile } from "../types";

type AdminSection = "dashboard" | "contents" | "categories" | "media" | "users" | "history" | "settings";
type StoredRow = { id: string; storage_bucket: string | null; storage_path: string | null };

const roleText: Record<AppRole, string> = { super_admin: "超级管理员", editor: "内容管理员", uploader: "上传管理员", viewer: "只读管理员" };
const statusText: Record<ContentStatus, string> = { draft: "草稿", published: "已发布", hidden: "隐藏", trashed: "回收站" };

function canEdit(role?: AppRole) { return role === "super_admin" || role === "editor" || role === "uploader"; }
function canPublish(role?: AppRole) { return role === "super_admin" || role === "editor"; }
function canEditItem(profile: Profile, item: ContentItem) {
  return profile.role === "super_admin" || profile.role === "editor" || (profile.role === "uploader" && item.status === "draft" && item.createdBy === profile.id);
}
function messageOf(error: unknown, fallback = "操作失败") { return error instanceof Error ? error.message : fallback; }

export function AdminPage() {
  const { user, profile, loading, profileError, signOut } = useAuth();
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  if (loading) return <div className="admin-gate"><LoaderCircle className="spin" />正在验证管理员权限...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile || profile.status !== "active") return <div className="admin-gate"><ShieldCheck /><h1>尚未获得后台权限</h1><p>{profileError || "请让超级管理员邀请或启用这个账号。"}</p><Link className="button quiet" to="/"><ArrowLeft />返回网站</Link></div>;

  const items: Array<[AdminSection, string, React.ReactNode]> = [
    ["dashboard", "仪表盘", <Gauge />], ["contents", "内容管理", <Database />], ["categories", "分类管理", <FolderTree />],
    ["media", "媒体与附件", <ImagePlus />], ["users", "账号权限", <Users />], ["history", "版本与日志", <History />], ["settings", "首页设置", <Settings />]
  ];
  return <div className="admin-shell"><aside className={menuOpen ? "admin-sidebar open" : "admin-sidebar"}><div className="admin-brand"><span>NK</span><div><strong>MapleStoryNK</strong><small>管理后台</small></div></div><nav>{items.map(([key, label, icon]) => <button key={key} className={section === key ? "active" : ""} onClick={() => { setSection(key); setMenuOpen(false); }}>{icon}{label}</button>)}</nav><div className="admin-account"><span>{profile.displayName}</span><small>{roleText[profile.role]}</small><button type="button" onClick={() => signOut()}><LogOut />退出</button></div></aside><main className="admin-main"><header className="admin-top"><button className="icon-only mobile-menu" type="button" onClick={() => setMenuOpen((value) => !value)}><Menu /></button><div><strong>{items.find(([key]) => key === section)?.[1]}</strong><span>正式数据后台</span></div><Link className="button quiet" to="/"><ArrowLeft />返回前台</Link></header><div className="admin-content">{section === "dashboard" && <Dashboard profile={profile} />}{section === "contents" && <ContentsPanel profile={profile} />}{section === "categories" && <CategoriesPanel profile={profile} />}{section === "media" && <MediaPanel profile={profile} />}{section === "users" && <UsersPanel profile={profile} />}{section === "history" && <HistoryPanel profile={profile} />}{section === "settings" && <SettingsPanel profile={profile} />}</div></main></div>;
}

function Dashboard({ profile }: { profile: Profile }) {
  const { backendMode } = useSiteData();
  const [migrationMessage, setMigrationMessage] = useState("");
  const [migrating, setMigrating] = useState(false);
  const contents = useQuery({ queryKey: ["admin-contents"], queryFn: loadAdminContents });
  const counts = useMemo(() => ({
    published: contents.data?.filter((item) => item.status === "published").length || 0,
    draft: contents.data?.filter((item) => item.status === "draft").length || 0,
    hidden: contents.data?.filter((item) => item.status === "hidden").length || 0,
    trashed: contents.data?.filter((item) => item.status === "trashed").length || 0
  }), [contents.data]);
  const migrateLegacy = async () => {
    if (!window.confirm("系统会先备份旧数据，再迁移现有分类、资料和媒体。确定开始吗？")) return;
    setMigrating(true); setMigrationMessage("正在备份并迁移旧数据，请不要关闭页面...");
    const { data, error } = await supabase.functions.invoke("migrate-legacy", { body: {} });
    if (error || data?.error) { setMigrationMessage(error?.message || data.error); setMigrating(false); return; }
    setMigrationMessage(`迁移完成：${data.categories} 个分类、${data.contents} 篇资料、${data.media} 个媒体。正在刷新...`);
    window.setTimeout(() => window.location.reload(), 1200);
  };
  return <><div className="admin-page-heading"><div><span>当前账号：{profile.displayName} / {roleText[profile.role]}</span><h1>内容概览</h1></div></div>{backendMode === "legacy" && profile.role === "super_admin" && <section className="admin-panel migration-panel"><div><span>LEGACY DATA</span><h2>正式后台尚未迁移旧资料</h2><p>迁移前会自动保存私有备份；核对数量成功后，预览站才会切换到正式数据表。</p></div><button className="button primary" type="button" disabled={migrating} onClick={migrateLegacy}>{migrating ? <LoaderCircle className="spin" /> : <ArchiveRestore />}{migrating ? "正在迁移..." : "迁移旧数据"}</button>{migrationMessage && <div className="form-message">{migrationMessage}</div>}</section>}<div className="metric-row"><div><span>已发布</span><strong>{counts.published}</strong></div><div><span>草稿</span><strong>{counts.draft}</strong></div><div><span>隐藏</span><strong>{counts.hidden}</strong></div><div><span>回收站</span><strong>{counts.trashed}</strong></div></div><section className="admin-panel"><h2>最近修改</h2><AdminContentTable items={(contents.data || []).slice(0, 8)} readonly /></section></>;
}

function ContentsPanel({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const contents = useQuery({ queryKey: ["admin-contents"], queryFn: loadAdminContents });
  const categories = useAdminCategories();
  const [editing, setEditing] = useState<ContentItem | "new" | null>(null);
  const [filter, setFilter] = useState<ContentStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const visible = (contents.data || []).filter((item) => (filter === "all" || item.status === filter) && (!query || `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase())));
  const refresh = () => { client.invalidateQueries({ queryKey: ["admin-contents"] }); client.invalidateQueries({ queryKey: ["public-site"] }); };
  const statusMutation = useMutation({
    mutationFn: ({ item, status }: { item: ContentItem; status: "draft" | "hidden" | "trashed" }) => changeContentStatus(item.id, item.version, status, profile.id),
    onSuccess: () => { setMessage("状态已更新。"); refresh(); }, onError: (error) => setMessage(messageOf(error))
  });
  const publishMutation = useMutation({
    mutationFn: (item: ContentItem) => publishContent(item.id, item.version),
    onSuccess: () => { setMessage("资料和关联文件已发布。"); refresh(); }, onError: (error) => setMessage(messageOf(error, "发布失败"))
  });
  return <><div className="admin-page-heading"><div><span>草稿、发布、隐藏和回收站</span><h1>内容管理</h1></div>{canEdit(profile.role) && <button className="button primary" onClick={() => setEditing("new")}><Plus />新增资料</button>}</div><div className="admin-filters"><div className="search-control"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索后台资料" /></div><select value={filter} onChange={(event) => setFilter(event.target.value as ContentStatus | "all")}><option value="all">全部状态</option>{Object.entries(statusText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{message && <div className="form-message action-message">{message}</div>}<section className="admin-panel"><AdminContentTable items={visible} onEdit={(item) => canEditItem(profile, item) && item.status !== "trashed" ? setEditing(item) : undefined} onTrash={profile.role === "super_admin" ? (item) => statusMutation.mutate({ item, status: "trashed" }) : undefined} onRestore={canPublish(profile.role) ? (item) => statusMutation.mutate({ item, status: "draft" }) : undefined} onPublish={canPublish(profile.role) ? (item) => publishMutation.mutate(item) : undefined} /></section>{editing && <ContentEditor item={editing === "new" ? null : editing} categories={categories.data || []} profile={profile} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}</>;
}

function AdminContentTable({ items, readonly, onEdit, onTrash, onRestore, onPublish }: { items: ContentItem[]; readonly?: boolean; onEdit?: (item: ContentItem) => void; onTrash?: (item: ContentItem) => void; onRestore?: (item: ContentItem) => void; onPublish?: (item: ContentItem) => void }) {
  return <div className="table-scroll"><table><thead><tr><th>标题</th><th>分类</th><th>状态</th><th>版本</th><th>更新时间</th>{!readonly && <th>操作</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><small>{item.summary}</small></td><td>{item.categoryName}</td><td><span className={`status ${item.status}`}>{statusText[item.status]}</span></td><td>v{item.version}</td><td>{new Date(item.updatedAt).toLocaleString("zh-CN")}</td>{!readonly && <td><div className="row-actions">{onEdit && item.status !== "trashed" && <button title="编辑" onClick={() => onEdit(item)}><FilePenLine /></button>}{onPublish && item.status !== "trashed" && <button title={item.status === "published" ? "同步新媒体并重新发布" : "发布"} onClick={() => onPublish(item)}><Check /></button>}{onRestore && item.status === "trashed" && <button title="恢复为草稿" onClick={() => onRestore(item)}><ArchiveRestore /></button>}{onTrash && item.status !== "trashed" && <button className="danger" title="移入回收站" onClick={() => onTrash(item)}><Trash2 /></button>}</div></td>}</tr>)}{!items.length && <tr><td colSpan={6}><div className="empty-table">暂无符合条件的内容</div></td></tr>}</tbody></table></div>;
}

function ContentEditor({ item, categories, profile, onClose, onSaved }: { item: ContentItem | null; categories: Category[]; profile: Profile; onClose(): void; onSaved(): void }) {
  const initial: ContentDraft = item ? { id: item.id, slug: item.slug, categoryId: item.categoryId, title: item.title, summary: item.summary, bodyHtml: item.bodyHtml, bodyJson: item.bodyJson, bodyText: item.bodyText, sourceRecord: item.sourceRecord, status: item.status, featured: item.featured, sortOrder: item.sortOrder, version: item.version, tags: item.tags } : { slug: "", categoryId: categories[0]?.id || "", title: "", summary: "", bodyHtml: "<p></p>", bodyJson: {}, bodyText: "", sourceRecord: "", status: "draft", featured: false, sortOrder: 100, tags: [] };
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const applyImport = (preview: Awaited<ReturnType<typeof readDocument>>) => {
    setDraft((current) => ({ ...current, title: current.title || preview.title, bodyHtml: preview.bodyHtml, bodyText: preview.bodyText, bodyJson: {}, sourceRecord: preview.source }));
    setMessage(preview.warning || `已读取“${preview.title}”，请确认正文后再保存。`);
  };
  const importFile = async (file: File) => { setImporting(true); setMessage("正在读取文档..."); try { applyImport(await readDocument(file)); } catch (error) { setMessage(messageOf(error, "文档读取失败")); } finally { setImporting(false); } };
  const importPage = async () => { if (!importUrl.trim()) return; setImporting(true); setMessage("正在安全读取网页正文..."); try { applyImport(await readWebPage(importUrl.trim())); } catch (error) { setMessage(`${messageOf(error, "网页读取失败")}。腾讯文档无法读取时，请下载 Word 后导入。`); } finally { setImporting(false); } };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage("");
    try { await saveContent({ ...draft, slug: draft.slug || slugify(draft.title), status: profile.role === "uploader" ? "draft" : draft.status }, profile.id); onSaved(); }
    catch (error) { setMessage(error instanceof Error && error.message === "VERSION_CONFLICT" ? "这篇资料已被其他管理员修改，请关闭后重新打开。" : messageOf(error, "保存失败")); }
    finally { setSaving(false); }
  };
  const availableStatuses: ContentStatus[] = profile.role === "uploader" ? ["draft"] : item?.status === "published" ? ["published", "draft", "hidden"] : ["draft", "hidden"];
  return <div className="drawer-backdrop" role="dialog" aria-modal="true"><form className="editor-drawer" onSubmit={submit}><header><div><span>{item ? `版本 ${item.version}` : "新资料"}</span><h2>{item ? "编辑资料" : "新增资料"}</h2></div><button className="icon-only" type="button" onClick={onClose}><X /></button></header><div className="editor-form"><section className="import-strip"><label><FileText /><span>导入 Word / TXT / Markdown</span><input type="file" accept=".docx,.txt,.md,.html" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ""; }} /></label><div><Link2 /><input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="粘贴网页链接" /><button type="button" disabled={importing} onClick={importPage}>读取</button></div></section><div className="form-grid"><label>标题<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>分类<select required value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label className="wide">简介<input required value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label><label>路径标识<input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: slugify(event.target.value) })} placeholder="自动生成" /></label><label>排序<input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /></label><label>状态<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ContentStatus })}>{availableStatuses.map((status) => <option value={status} key={status}>{statusText[status]}</option>)}</select></label><label className="wide">后台来源记录<input value={draft.sourceRecord} onChange={(event) => setDraft({ ...draft, sourceRecord: event.target.value })} /></label><label className="checkbox wide"><input type="checkbox" checked={draft.featured} onChange={(event) => setDraft({ ...draft, featured: event.target.checked })} />首页精选</label></div><label className="editor-label">正文内容<RichEditor value={draft.bodyHtml} onChange={(bodyHtml, bodyText, bodyJson) => setDraft((current) => ({ ...current, bodyHtml, bodyText, bodyJson }))} /></label>{message && <div className="form-message">{message}</div>}</div><footer><button className="button quiet" type="button" onClick={onClose}>取消</button><button className="button primary" disabled={saving || importing} type="submit"><Save />{saving ? "正在保存..." : "保存资料"}</button></footer></form></div>;
}

function useAdminCategories() {
  return useQuery({ queryKey: ["admin-categories"], queryFn: async () => { const { data, error } = await supabase.from("categories").select("*").order("sort_order"); if (error) throw error; return (data || []).map((row) => ({ id: row.id, slug: row.slug, name: row.name, description: row.description || "", imageUrl: row.image_path || "", sortOrder: row.sort_order, visible: row.is_visible })) as Category[]; } });
}

function CategoriesPanel({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const categories = useAdminCategories();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ["admin-categories"] }); queryClient.invalidateQueries({ queryKey: ["public-site"] }); };
  const create = useMutation({ mutationFn: async () => { const { error } = await supabase.from("categories").insert({ name, slug: slugify(name), description, sort_order: ((categories.data?.length || 0) + 1) * 10, created_by: profile.id, updated_by: profile.id }); if (error) throw error; }, onSuccess: () => { setName(""); setDescription(""); refresh(); }, onError: (error) => setMessage(messageOf(error)) });
  const update = async (category: Category, patch: Record<string, unknown>) => { const { error } = await supabase.from("categories").update({ ...patch, updated_by: profile.id }).eq("id", category.id); if (error) throw error; refresh(); };
  const move = async (index: number, direction: -1 | 1) => { const rows = [...(categories.data || [])]; const target = index + direction; if (!rows[target]) return; [rows[index], rows[target]] = [rows[target], rows[index]]; try { await Promise.all(rows.map((row, position) => supabase.from("categories").update({ sort_order: (position + 1) * 10, updated_by: profile.id }).eq("id", row.id).then(({ error }) => { if (error) throw error; }))); refresh(); } catch (error) { setMessage(messageOf(error, "排序保存失败")); } };
  return <><div className="admin-page-heading"><div><span>名称、说明、图片、显示状态和顺序</span><h1>分类管理</h1></div></div>{canPublish(profile.role) && <section className="admin-panel"><h2>新增分类</h2><form className="inline-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="分类名称" /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="分类说明" /><button className="button primary" type="submit"><Plus />新增</button></form></section>}{message && <div className="form-message action-message">{message}</div>}<section className="admin-panel"><div className="category-admin-list">{categories.data?.map((category, index) => <CategoryEditor key={category.id} category={category} editable={canPublish(profile.role)} first={index === 0} last={index === (categories.data?.length || 0) - 1} onMove={(direction) => move(index, direction)} onSave={(patch) => update(category, patch)} onMessage={setMessage} />)}</div></section></>;
}

function CategoryEditor({ category, editable, first, last, onMove, onSave, onMessage }: { category: Category; editable: boolean; first: boolean; last: boolean; onMove(direction: -1 | 1): void; onSave(patch: Record<string, unknown>): Promise<void>; onMessage(value: string): void }) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description);
  const [uploading, setUploading] = useState(false);
  const uploadImage = async (file: File) => { setUploading(true); try { if (!file.type.startsWith("image/")) throw new Error("请选择图片文件"); const prepared = await imageToWebp(file); const path = `categories/${category.id}/${crypto.randomUUID()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; await uploadWithProgress(prepared, path, () => undefined, undefined, publicMediaBucket); await onSave({ image_path: path }); onMessage("分类图片已替换。"); } catch (error) { onMessage(messageOf(error, "图片上传失败")); } finally { setUploading(false); } };
  return <div className="category-editor"><div className="sort-buttons"><button disabled={!editable || first} title="上移" onClick={() => onMove(-1)}><ArrowUp /></button><button disabled={!editable || last} title="下移" onClick={() => onMove(1)}><ArrowDown /></button></div><div className="category-fields"><input disabled={!editable} value={name} onChange={(event) => setName(event.target.value)} /><input disabled={!editable} value={description} onChange={(event) => setDescription(event.target.value)} /></div><label className="small-upload"><ImagePlus />{uploading ? "上传中" : "替换图片"}<input type="file" accept="image/*" disabled={!editable || uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadImage(file); event.target.value = ""; }} /></label><button className={`status ${category.visible ? "published" : "hidden"}`} disabled={!editable} onClick={() => onSave({ is_visible: !category.visible })}>{category.visible ? "显示" : "隐藏"}</button><button className="icon-only" disabled={!editable || !name.trim()} title="保存分类文字" onClick={() => onSave({ name: name.trim(), slug: slugify(name), description })}><Save /></button></div>;
}

function MediaPanel({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const contents = useQuery({ queryKey: ["admin-contents"], queryFn: loadAdminContents });
  const [contentId, setContentId] = useState("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const eligible = (contents.data || []).filter((item) => item.status !== "trashed" && (profile.role !== "uploader" || (item.status === "draft" && item.createdBy === profile.id)));
  const records = useQuery({ queryKey: ["admin-media", contentId], enabled: Boolean(contentId), queryFn: async () => { const [media, attachments] = await Promise.all([supabase.from("content_media").select("*").eq("content_id", contentId).order("sort_order"), supabase.from("attachments").select("*").eq("content_id", contentId).order("sort_order")]); if (media.error) throw media.error; if (attachments.error) throw attachments.error; return { media: media.data || [], attachments: attachments.data || [] }; } });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-media", contentId] });
  const upload = async (files: File[]) => { if (!contentId) return setMessage("请先选择一篇资料。"); controller.current = new AbortController(); setMessage(""); try { for (const [index, file] of files.entries()) { const type = validateUpload(file); const prepared = type.image ? await imageToWebp(file) : file; const path = `${profile.id}/${contentId}/${crypto.randomUUID()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; const stored = await uploadWithProgress(prepared, path, (value) => setProgress(Math.round(((index + value.percent / 100) / files.length) * 100)), controller.current.signal); const base = { content_id: contentId, storage_bucket: stored.bucket, storage_path: stored.path, sort_order: (records.data?.media.length || 0) * 10 + (index + 1) * 10, created_by: profile.id, mime_type: prepared.type, size_bytes: prepared.size }; const dimensions = type.image ? await imageDimensions(prepared) : {}; const result = type.document ? await supabase.from("attachments").insert({ ...base, name: file.name }) : await supabase.from("content_media").insert({ ...base, kind: type.video ? "video" : "image", title: file.name.replace(/\.[^.]+$/, ""), alt_text: file.name, ...dimensions }); if (result.error) { await supabase.storage.from(stored.bucket).remove([stored.path]); throw result.error; } } setMessage(`已上传 ${files.length} 个文件，发布资料后会转入公开区域。`); refresh(); } catch (error) { setMessage(error instanceof DOMException && error.name === "AbortError" ? "上传已取消。" : messageOf(error, "上传失败")); } finally { controller.current = null; setProgress(0); } };
  const removeStored = async (table: "content_media" | "attachments", row: StoredRow) => { if (!window.confirm("确定删除这个文件记录吗？")) return; const { error } = await supabase.from(table).delete().eq("id", row.id); if (error) return setMessage(error.message); if (row.storage_bucket && row.storage_path) await supabase.storage.from(row.storage_bucket).remove([row.storage_path]); refresh(); };
  return <><div className="admin-page-heading"><div><span>批量上传、名称、标注、多级路径和附件</span><h1>媒体与附件</h1></div></div><section className="admin-panel media-uploader"><label>关联资料<select value={contentId} onChange={(event) => setContentId(event.target.value)}><option value="">请选择资料</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.title} · {statusText[item.status]}</option>)}</select></label><label className="drop-zone"><Upload /><strong>批量选择图片、MP4、WebM 或附件</strong><span>图片自动转 WebP，单文件最大 100MB</span><input type="file" multiple accept="image/*,video/mp4,video/webm,.pdf,.zip,.docx,.txt" onChange={(event) => { const files = [...(event.target.files || [])]; if (files.length) upload(files); event.target.value = ""; }} disabled={!canEdit(profile.role) || !contentId || Boolean(controller.current)} /></label>{progress > 0 && <div className="upload-status"><div className="upload-progress"><span style={{ width: `${progress}%` }} /><strong>{progress}%</strong></div><button className="button quiet" type="button" onClick={() => controller.current?.abort()}><Ban />取消上传</button></div>}{message && <div className="form-message">{message}</div>}</section>{contentId && <section className="admin-panel"><h2>图片与视频</h2><div className="media-admin-list">{records.data?.media.map((row) => <MediaEditor key={row.id} row={row} editable={canEdit(profile.role)} onSaved={refresh} onRemove={() => removeStored("content_media", row)} onMessage={setMessage} />)}{!records.data?.media.length && <div className="empty-table">暂无图片或视频</div>}</div><h2 className="panel-subheading">附件</h2><div className="attachment-admin-list">{records.data?.attachments.map((row) => <div key={row.id}><FileText /><input defaultValue={row.name} disabled={!canEdit(profile.role)} onBlur={async (event) => { const { error } = await supabase.from("attachments").update({ name: event.target.value }).eq("id", row.id); if (error) setMessage(error.message); else refresh(); }} /><span>{row.mime_type || "附件"}</span>{canEdit(profile.role) && <button className="icon-only danger" title="删除附件" onClick={() => removeStored("attachments", row)}><Trash2 /></button>}</div>)}{!records.data?.attachments.length && <div className="empty-table">暂无附件</div>}</div></section>}</>;
}

function MediaEditor({ row, editable, onSaved, onRemove, onMessage }: { row: Record<string, unknown>; editable: boolean; onSaved(): void; onRemove(): void; onMessage(value: string): void }) {
  const [title, setTitle] = useState(String(row.title || ""));
  const [note, setNote] = useState(String(row.note || ""));
  const [path, setPath] = useState(Array.isArray(row.hierarchy_path) ? row.hierarchy_path.join(" / ") : "");
  const [sortOrder, setSortOrder] = useState(Number(row.sort_order || 100));
  const save = async () => { const { error } = await supabase.from("content_media").update({ title: title.trim(), note: note.trim(), hierarchy_path: path.split("/").map((part) => part.trim()).filter(Boolean), alt_text: title.trim(), sort_order: sortOrder }).eq("id", row.id); if (error) onMessage(error.message); else { onMessage("媒体名称与标注已保存。"); onSaved(); } };
  return <div className="media-editor"><div className="media-kind">{row.kind === "video" ? "视频" : "图片"}<small>{String(row.mime_type || "")}</small></div><div className="media-fields"><input disabled={!editable} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="图片名称" /><input disabled={!editable} value={path} onChange={(event) => setPath(event.target.value)} placeholder="一级 / 二级 / 三级" /><textarea disabled={!editable} value={note} onChange={(event) => setNote(event.target.value)} placeholder="图片标注或详细说明" /><input disabled={!editable} type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} title="排序" /></div>{editable && <div className="row-actions"><button title="保存" onClick={save}><Save /></button><button className="danger" title="删除" onClick={onRemove}><Trash2 /></button></div>}</div>;
}

function UsersPanel({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const users = useQuery({ queryKey: ["profiles"], queryFn: async () => { const { data, error } = await supabase.from("profiles").select("*").order("created_at"); if (error) throw error; return data || []; }, enabled: profile.role === "super_admin" });
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [message, setMessage] = useState("");
  if (profile.role !== "super_admin") return <ReadOnlyNotice text="只有超级管理员可以邀请和修改账号权限。" />;
  const invite = async (event: React.FormEvent) => { event.preventDefault(); setMessage(""); const { data, error } = await supabase.functions.invoke("invite-admin", { body: { email, displayName, role } }); if (error || data?.error) return setMessage(error?.message || data.error); setMessage("邀请邮件已发送。对方完成邮件验证后即可登录。"); setEmail(""); setDisplayName(""); client.invalidateQueries({ queryKey: ["profiles"] }); };
  return <><div className="admin-page-heading"><div><span>邀请制后台账号与真实权限</span><h1>账号权限</h1></div></div><section className="admin-panel"><h2>邀请管理员</h2><form className="inline-form user-invite" onSubmit={invite}><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="管理员邮箱" /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称" /><select value={role} onChange={(event) => setRole(event.target.value as AppRole)}>{Object.entries(roleText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="button primary" type="submit"><UserPlus />发送邀请</button></form>{message && <div className="form-message">{message}</div>}</section><section className="admin-panel"><div className="user-admin-list">{users.data?.map((row) => <UserEditor key={row.id} row={row} currentUserId={profile.id} onSaved={() => client.invalidateQueries({ queryKey: ["profiles"] })} onMessage={setMessage} />)}</div></section></>;
}

function UserEditor({ row, currentUserId, onSaved, onMessage }: { row: Record<string, unknown>; currentUserId: string; onSaved(): void; onMessage(value: string): void }) {
  const [displayName, setDisplayName] = useState(String(row.display_name || ""));
  const [role, setRole] = useState<AppRole>(row.role as AppRole);
  const [status, setStatus] = useState(String(row.status || "active"));
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); const { data, error } = await supabase.functions.invoke("update-admin", { body: { userId: row.id, displayName, role, status, password } }); setSaving(false); if (error || data?.error) return onMessage(error?.message || data.error); setPassword(""); onMessage("账号资料和权限已更新。"); onSaved(); };
  return <div className="user-editor"><div><strong>{displayName || String(row.email)}</strong><small>{String(row.email)}{row.id === currentUserId ? " · 当前账号" : ""}</small></div><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称" /><select value={role} onChange={(event) => setRole(event.target.value as AppRole)}><option value="super_admin">超级管理员</option><option value="editor">内容管理员</option><option value="uploader">上传管理员</option><option value="viewer">只读管理员</option></select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">启用</option><option value="disabled">停用</option><option value="invited">待接受邀请</option></select><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="新密码（留空不修改）" autoComplete="new-password" /><button className="icon-only" disabled={saving} title="保存账号" onClick={save}>{saving ? <LoaderCircle className="spin" /> : <Save />}</button></div>;
}

function HistoryPanel({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const logs = useQuery({ queryKey: ["audit-logs"], queryFn: async () => { const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100); if (error) throw error; return data || []; } });
  const revisions = useQuery({ queryKey: ["content-revisions"], queryFn: async () => { const { data, error } = await supabase.from("content_revisions").select("id, content_id, version, created_at, contents(title, version)").order("created_at", { ascending: false }).limit(50); if (error) throw error; return data || []; } });
  const restore = async (row: Record<string, unknown>) => { if (!window.confirm("恢复后会生成新的草稿版本，确定继续吗？")) return; const content = row.contents as { title: string; version: number } | null; const { data, error } = await supabase.functions.invoke("restore-revision", { body: { revisionId: row.id, version: content?.version } }); if (error || data?.error) return setMessage(error?.message || data.error); setMessage("历史版本已恢复为草稿，请检查后重新发布。"); client.invalidateQueries({ queryKey: ["content-revisions"] }); client.invalidateQueries({ queryKey: ["admin-contents"] }); };
  return <><div className="admin-page-heading"><div><span>历史版本、恢复与最近 100 条操作</span><h1>版本与日志</h1></div></div>{message && <div className="form-message action-message">{message}</div>}<section className="admin-panel"><h2>内容历史版本</h2><div className="revision-list">{revisions.data?.map((row) => { const content = row.contents as unknown as { title: string; version: number } | null; return <div key={row.id}><RotateCcw /><div><strong>{content?.title || row.content_id}</strong><span>历史 v{row.version} · 当前 v{content?.version || "-"}</span></div><time>{new Date(row.created_at).toLocaleString("zh-CN")}</time>{canPublish(profile.role) && <button className="button quiet" onClick={() => restore(row)}>恢复</button>}</div>; })}{!revisions.data?.length && <div className="empty-table">尚无历史版本</div>}</div></section><section className="admin-panel"><h2>操作日志</h2><div className="audit-list">{logs.data?.map((log) => <div key={log.id}><Activity /><div><strong>{log.action} · {log.entity_type}</strong><span>{log.entity_id}</span></div><time>{new Date(log.created_at).toLocaleString("zh-CN")}</time></div>)}</div></section></>;
}

function SettingsPanel({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["admin-settings"], queryFn: async () => { const { data, error } = await supabase.from("site_settings").select("*").eq("id", "main").single(); if (error) throw error; return data; } });
  const [message, setMessage] = useState("");
  if (profile.role !== "super_admin") return <ReadOnlyNotice text="只有超级管理员可以修改首页设置。" />;
  if (!settings.data) return <div className="admin-gate"><LoaderCircle className="spin" />读取设置...</div>;
  const refresh = () => { client.invalidateQueries({ queryKey: ["admin-settings"] }); client.invalidateQueries({ queryKey: ["public-site"] }); };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const { error } = await supabase.from("site_settings").update({ brand_title: form.get("brandTitle"), brand_subtitle: form.get("brandSubtitle"), hero_title: form.get("heroTitle"), hero_subtitle: form.get("heroSubtitle"), category_title: form.get("categoryTitle"), category_subtitle: form.get("categorySubtitle"), updated_by: profile.id }).eq("id", "main"); setMessage(error ? error.message : "首页文字已保存。"); if (!error) refresh(); };
  const assets: Array<[string, string]> = [["top_logo_path", "顶部 Logo"], ["hero_logo_path", "首页 Logo"], ["page_background_path", "全站背景"], ["hero_background_path", "首页主背景"], ["tile_background_path", "类目默认背景"]];
  return <><div className="admin-page-heading"><div><span>品牌文字、Logo 和所有界面背景</span><h1>首页设置</h1></div></div><section className="admin-panel"><h2>站点文字</h2><form className="form-grid" onSubmit={submit}><label>站点名称<input name="brandTitle" defaultValue={settings.data.brand_title} /></label><label>顶部副标题<input name="brandSubtitle" defaultValue={settings.data.brand_subtitle} /></label><label>首页标题<input name="heroTitle" defaultValue={settings.data.hero_title} /></label><label>首页说明<input name="heroSubtitle" defaultValue={settings.data.hero_subtitle} /></label><label>类目区标题<input name="categoryTitle" defaultValue={settings.data.category_title} /></label><label>类目区说明<input name="categorySubtitle" defaultValue={settings.data.category_subtitle} /></label><button className="button primary" type="submit"><Save />保存文字</button></form></section><section className="admin-panel"><h2>界面图片</h2><div className="setting-assets">{assets.map(([field, label]) => <SettingAsset key={field} field={field} label={label} current={String(settings.data[field] || "")} userId={profile.id} onSaved={() => { setMessage(`${label}已替换。`); refresh(); }} onMessage={setMessage} />)}</div>{message && <div className="form-message">{message}</div>}</section></>;
}

function SettingAsset({ field, label, current, userId, onSaved, onMessage }: { field: string; label: string; current: string; userId: string; onSaved(): void; onMessage(value: string): void }) {
  const [progress, setProgress] = useState(0);
  const upload = async (file: File) => { try { if (!file.type.startsWith("image/")) throw new Error("请选择图片文件"); const prepared = await imageToWebp(file); const path = `settings/${field}/${crypto.randomUUID()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; await uploadWithProgress(prepared, path, (value) => setProgress(value.percent), undefined, publicMediaBucket); const { error } = await supabase.from("site_settings").update({ [field]: path, updated_by: userId }).eq("id", "main"); if (error) throw error; onSaved(); } catch (error) { onMessage(messageOf(error, "图片上传失败")); } finally { setProgress(0); } };
  return <div><div><strong>{label}</strong><small>{current || "尚未设置"}</small></div>{progress > 0 ? <span>{progress}%</span> : <label className="small-upload"><Upload />替换<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /></label>}</div>;
}

function ReadOnlyNotice({ text }: { text: string }) { return <div className="admin-gate"><ShieldCheck /><h1>权限受限</h1><p>{text}</p></div>; }
