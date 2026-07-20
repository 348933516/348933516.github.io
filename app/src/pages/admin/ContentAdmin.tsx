import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight,
  Copy, Database, Eye, FileImage, FilePenLine, FileText, FolderOpen, Gauge, ImagePlus,
  Layers3, Link2, LoaderCircle, Plus, RefreshCcw, Save, Search, Trash2, Upload, X
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { RichContent } from "../../components/RichContent";
import { VideoPlayer } from "../../components/VideoPlayer";
import { privateMediaBucket, publicMediaBucket } from "../../lib/config";
import type { ExtractedWordImage, ImportPreview, WorksheetPreview } from "../../lib/documents";
import { randomId } from "../../lib/id";
import {
  batchContent, cancelDocumentImport, changeContentStatus, deleteContentForever, duplicateContent, finalizeDocumentImport,
  loadAdminContent, loadAdminContentList, publishContent, saveContent, startDocumentImport, DocumentImportError, type DocumentImportAsset, type DocumentImportStage
} from "../../lib/repository";
import { reportRuntimeLog } from "../../lib/runtimeLogs";
import { sanitizeHtml, slugify } from "../../lib/sanitize";
import { supabase } from "../../lib/supabase";
import { imageDimensions, imageToWebp, uploadWithProgress, validateUpload } from "../../lib/uploads";
import type { Category, ContentDraft, ContentItem, ContentStatus, Profile } from "../../types";
import {
  AdminEmpty, AdminLoading, AdminToast, canEdit, canEditItem, canPublish, formatBytes,
  formatDate, messageOf, publicAssetUrl, roleText, StatusBadge, statusText, useAdminCategories
} from "./shared";

const pageSize = 20;
const RichEditor = lazy(() => import("../../components/RichEditor").then((module) => ({ default: module.RichEditor })));

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function composeImportPreview(worksheets: WorksheetPreview[], selectedNames: string[]) {
  const selected = worksheets.filter((sheet) => selectedNames.includes(sheet.name));
  const bodyHtml = sanitizeHtml(selected.map((sheet) => `<h2>${escapeHtml(sheet.name)}</h2>${sheet.bodyHtml}`).join(""));
  return { bodyHtml, bodyText: selected.map((sheet) => `${sheet.name}\n${sheet.bodyText}`).join("\n\n") };
}

export function DashboardPage({ profile }: { profile: Profile }) {
  const contents = useQuery({ queryKey: ["admin-content-list"], queryFn: loadAdminContentList, staleTime: 30_000 });
  const logs = useQuery({ queryKey: ["dashboard-logs"], queryFn: async () => {
    const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(8);
    if (error) throw error; return data || [];
  } });
  const storage = useQuery({ queryKey: ["dashboard-storage"], queryFn: async () => {
    const [media, attachments] = await Promise.all([
      supabase.from("content_media").select("size_bytes"), supabase.from("attachments").select("size_bytes")
    ]);
    if (media.error) throw media.error; if (attachments.error) throw attachments.error;
    return [...(media.data || []), ...(attachments.data || [])].reduce((sum, row) => sum + Number(row.size_bytes || 0), 0);
  } });
  if (contents.isLoading) return <AdminLoading label="正在准备工作台" />;
  const items = contents.data || [];
  const count = (status: ContentStatus) => items.filter((item) => item.status === status).length;
  return <div className="admin-page-stack"><header className="admin-page-heading"><div><span>{profile.displayName} · {roleText[profile.role]}</span><h1>内容工作台</h1><p>集中处理草稿、发布状态和最近操作。</p></div>{canEdit(profile.role) && <Link className="button primary" to="/admin/contents/new"><Plus />新建资料</Link>}</header>
    <div className="metric-row"><Link to="/admin/contents?status=published"><span>已发布</span><strong>{count("published")}</strong><small>前台可见内容</small></Link><Link to="/admin/contents?status=draft"><span>待处理草稿</span><strong>{count("draft")}</strong><small>继续编辑与发布</small></Link><Link to="/admin/contents?status=hidden"><span>隐藏内容</span><strong>{count("hidden")}</strong><small>仅后台可见</small></Link><Link to="/admin/media"><span>媒体容量</span><strong>{formatBytes(storage.data || 0)}</strong><small>图片、视频与附件</small></Link></div>
    <div className="admin-dashboard-grid"><section className="admin-panel"><div className="panel-heading"><div><h2>待处理内容</h2><p>草稿和隐藏资料</p></div><Link to="/admin/contents">查看全部<ChevronRight /></Link></div><CompactContentList items={items.filter((item) => item.status === "draft" || item.status === "hidden").slice(0, 6)} /></section>
      <section className="admin-panel"><div className="panel-heading"><div><h2>最近操作</h2><p>系统记录的后台变更</p></div><Link to="/admin/history">查看日志<ChevronRight /></Link></div><div className="activity-feed">{logs.data?.map((log) => <div key={log.id}><span className="activity-dot" /><div><strong>{actionText(String(log.action))}</strong><small>{String(log.entity_type)} · {String(log.entity_id).slice(0, 12)}</small></div><time>{formatDate(log.created_at)}</time></div>)}{!logs.data?.length && <AdminEmpty title="暂无操作记录" />}</div></section></div>
  </div>;
}

function actionText(action: string) {
  return ({ INSERT: "新增记录", UPDATE: "更新记录", DELETE: "删除记录" } as Record<string, string>)[action.toUpperCase()] || action;
}

function CompactContentList({ items }: { items: ContentItem[] }) {
  if (!items.length) return <AdminEmpty title="没有待处理内容" detail="当前草稿和隐藏内容均已处理。" />;
  return <div className="compact-content-list">{items.map((item) => <Link key={item.id} to={`/admin/contents/${item.id}`}><ContentThumb item={item} /><div><strong>{item.title}</strong><span>{item.categoryName} · {formatDate(item.updatedAt)}</span></div><StatusBadge status={item.status} /></Link>)}</div>;
}

function ContentThumb({ item }: { item: ContentItem }) {
  const source = item.media.find((media) => media.kind === "image")?.src;
  return <span className="content-thumb">{source ? <img src={source} alt="" /> : <FileImage />}</span>;
}

export function ContentListPage({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const contents = useQuery({ queryKey: ["admin-content-list"], queryFn: loadAdminContentList, staleTime: 30_000 });
  const categories = useAdminCategories();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [batchCategory, setBatchCategory] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const query = params.get("q") || "";
  const status = (params.get("status") || "all") as ContentStatus | "all";
  const category = params.get("category") || "all";
  const sort = params.get("sort") || "updated";
  const page = Math.max(1, Number(params.get("page") || 1));
  const updateParam = (name: string, value: string) => { const next = new URLSearchParams(params); if (!value || value === "all" || (name === "sort" && value === "updated")) next.delete(name); else next.set(name, value); if (name !== "page") next.delete("page"); setParams(next); };
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = (contents.data || []).filter((item) => (status === "all" || item.status === status) && (category === "all" || item.categoryId === category) && (!term || `${item.title} ${item.summary} ${item.categoryName}`.toLowerCase().includes(term)));
    return [...rows].sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "order" ? a.sortOrder - b.sortOrder : +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }, [contents.data, status, category, query, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);
  const refresh = () => { client.invalidateQueries({ queryKey: ["admin-content-list"] }); client.invalidateQueries({ queryKey: ["admin-contents"] }); client.invalidateQueries({ queryKey: ["public-home"] }); client.invalidateQueries({ queryKey: ["public-category"] }); client.invalidateQueries({ queryKey: ["public-content"] }); setSelected(new Set()); };
  const notify = (value: string, error = false) => { setMessage(value); setMessageError(error); };
  const markPending = (ids: string[], value: boolean) => setPendingIds((current) => { const next = new Set(current); ids.forEach((id) => value ? next.add(id) : next.delete(id)); return next; });
  const runStatus = async (item: ContentItem, next: "draft" | "hidden" | "trashed") => {
    const previous = client.getQueryData<ContentItem[]>(["admin-content-list"]);
    client.setQueryData<ContentItem[]>(["admin-content-list"], (rows = []) => rows.map((row) => row.id === item.id ? { ...row, status: next, version: row.version + 1 } : row));
    markPending([item.id], true);
    try { await changeContentStatus(item.id, item.version, next, profile.id); notify(next === "trashed" ? "已移入回收站。" : "状态已更新。"); refresh(); }
    catch (error) { client.setQueryData(["admin-content-list"], previous); notify(messageOf(error), true); }
    finally { markPending([item.id], false); }
  };
  const runPublish = async (item: ContentItem) => { try { await publishContent(item.id, item.version); notify("资料和媒体已发布。"); refresh(); } catch (error) { notify(messageOf(error, "发布失败"), true); } };
  const runDuplicate = async (item: ContentItem) => { try { const copy = await duplicateContent(item.id); notify("已复制为草稿。"); refresh(); navigate(`/admin/contents/${copy.id}`); } catch (error) { notify(messageOf(error, "复制失败"), true); } };
  const runDeleteForever = async (item: ContentItem) => {
    const previous = client.getQueryData<ContentItem[]>(["admin-content-list"]);
    client.setQueryData<ContentItem[]>(["admin-content-list"], (rows = []) => rows.filter((row) => row.id !== item.id));
    markPending([item.id], true);
    try { const result = await deleteContentForever([{ id: item.id, version: item.version }]); if (result.succeeded !== 1) throw new Error(result.results[0]?.error || "删除失败"); notify("资料已删除，关联文件正在后台清理。"); refresh(); }
    catch (error) { client.setQueryData(["admin-content-list"], previous); notify(messageOf(error, "彻底删除失败"), true); }
    finally { markPending([item.id], false); }
  };
  const runBatch = async (action: "move" | "draft" | "hidden" | "trashed" | "published" | "delete_forever") => {
    const rows = (contents.data || []).filter((item) => selected.has(item.id)); if (!rows.length) return;
    const previous = client.getQueryData<ContentItem[]>(["admin-content-list"]);
    markPending(rows.map((row) => row.id), true);
    if (action === "delete_forever") client.setQueryData<ContentItem[]>(["admin-content-list"], (items = []) => items.filter((item) => !selected.has(item.id)));
    else if (["draft", "hidden", "trashed"].includes(action)) client.setQueryData<ContentItem[]>(["admin-content-list"], (items = []) => items.map((item) => selected.has(item.id) ? { ...item, status: action as ContentStatus, version: item.version + 1 } : item));
    try {
      if (action === "published") { for (const row of rows) await publishContent(row.id, row.version); notify(`已发布 ${rows.length} 篇资料。`); }
      else if (action === "delete_forever") { const result = await deleteContentForever(rows.map(({ id, version }) => ({ id, version }))); notify(`已彻底删除 ${result.succeeded} 篇资料。`, result.succeeded !== rows.length || Boolean(result.storageWarnings?.length)); }
      else { const result = await batchContent(rows.map(({ id, version }) => ({ id, version })), action, action === "move" ? batchCategory : undefined); notify(`已处理 ${result.succeeded} 篇资料。`, result.succeeded !== rows.length); }
      refresh();
    } catch (error) { client.setQueryData(["admin-content-list"], previous); notify(messageOf(error, "批量操作失败"), true); }
    finally { markPending(rows.map((row) => row.id), false); }
  };
  if (contents.isLoading) return <AdminLoading label="正在读取内容" />;
  const counts = Object.fromEntries((["published", "draft", "hidden", "trashed"] as ContentStatus[]).map((key) => [key, (contents.data || []).filter((item) => item.status === key).length]));
  const selectedRows = (contents.data || []).filter((item) => selected.has(item.id));
  const canDeleteForever = profile.role === "super_admin" && selectedRows.length > 0 && selectedRows.every((item) => item.status === "trashed");
  return <div className="admin-page-stack"><AdminToast message={message} error={messageError} onClose={() => setMessage("")} /><header className="admin-page-heading"><div><span>CONTENT LIBRARY</span><h1>内容管理</h1><p>搜索、筛选、批量处理和发布资料。</p></div>{canEdit(profile.role) && <Link className="button primary" to="/admin/contents/new"><Plus />新增资料</Link>}</header>
    <div className="status-tabs"><button className={status === "all" ? "active" : ""} onClick={() => updateParam("status", "all")}>全部 <span>{contents.data?.length || 0}</span></button>{(["published", "draft", "hidden", "trashed"] as ContentStatus[]).map((key) => <button className={status === key ? "active" : ""} key={key} onClick={() => updateParam("status", key)}>{statusText[key]} <span>{counts[key]}</span></button>)}</div>
    <div className="admin-filterbar"><label className="search-control"><Search /><input value={query} onChange={(event) => updateParam("q", event.target.value)} placeholder="搜索标题、简介或分类" /></label><select value={category} onChange={(event) => updateParam("category", event.target.value)}><option value="all">全部分类</option>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={sort} onChange={(event) => updateParam("sort", event.target.value)}><option value="updated">最近更新</option><option value="title">标题排序</option><option value="order">自定义顺序</option></select></div>
    {selected.size > 0 && <div className="batch-toolbar"><strong>已选择 {selected.size} 项</strong><select value={batchCategory} onChange={(event) => setBatchCategory(event.target.value)}><option value="">移动到分类</option>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button disabled={!batchCategory} onClick={() => runBatch("move")}>移动</button>{canPublish(profile.role) && <><button onClick={() => runBatch("published")}><Check />发布</button><button onClick={() => runBatch("hidden")}><Eye />隐藏</button></>}{profile.role === "super_admin" && <button className="danger" onClick={() => window.confirm("确定将所选内容移入回收站吗？") && runBatch("trashed")}><Trash2 />回收</button>}{canDeleteForever && <button className="danger" onClick={() => window.confirm("确定永久删除所选回收站内容吗？此操作无法撤销。") && runBatch("delete_forever")}><Trash2 />彻底删除</button>}<button className="icon-only" onClick={() => setSelected(new Set())}><X /></button></div>}
    <section className="admin-panel flush"><div className="content-admin-table"><div className="content-table-head"><input type="checkbox" checked={visible.length > 0 && visible.every((item) => selected.has(item.id))} onChange={(event) => setSelected(event.target.checked ? new Set([...selected, ...visible.map((item) => item.id)]) : new Set([...selected].filter((id) => !visible.some((item) => item.id === id))))} /><span>资料</span><span>分类</span><span>状态</span><span>更新时间</span><span>操作</span></div>{visible.map((item) => <div className={`content-table-row${pendingIds.has(item.id) ? " pending" : ""}`} key={item.id}><input type="checkbox" disabled={pendingIds.has(item.id)} checked={selected.has(item.id)} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(item.id) : next.delete(item.id); setSelected(next); }} /><ContentThumb item={item} /><div className="content-row-title"><Link to={`/admin/contents/${item.id}`}>{item.title}</Link><span>{item.summary || "暂无简介"}</span></div><span>{item.categoryName}</span><StatusBadge status={item.status} /><time>{formatDate(item.updatedAt)}</time><div className="row-actions">{pendingIds.has(item.id) ? <LoaderCircle className="spin" /> : <>{canEditItem(profile, item) && item.status !== "trashed" && <Link title="编辑" to={`/admin/contents/${item.id}`}><FilePenLine /></Link>}{canEdit(profile.role) && item.status !== "trashed" && <button title="复制为草稿" onClick={() => runDuplicate(item)}><Copy /></button>}{canPublish(profile.role) && item.status !== "trashed" && <button title="发布" onClick={() => runPublish(item)}><Check /></button>}{item.status === "trashed" && canPublish(profile.role) && <button title="恢复草稿" onClick={() => runStatus(item, "draft")}><ArchiveRestore /></button>}{item.status === "trashed" && profile.role === "super_admin" && <button className="danger" title="彻底删除" onClick={() => window.confirm(`确定永久删除“${item.title}”吗？此操作无法撤销。`) && runDeleteForever(item)}><Trash2 /></button>}{profile.role === "super_admin" && item.status !== "trashed" && <button className="danger" title="移入回收站" onClick={() => window.confirm(`确定回收“${item.title}”吗？`) && runStatus(item, "trashed")}><Trash2 /></button>}</>}</div></div>)}{!visible.length && <AdminEmpty title="没有符合条件的资料" detail="调整筛选条件或新建一篇资料。" />}</div></section>
    <div className="pagination"><span>共 {filtered.length} 条</span><button disabled={page <= 1} onClick={() => updateParam("page", String(page - 1))}><ChevronLeft /></button><strong>{Math.min(page, pages)} / {pages}</strong><button disabled={page >= pages} onClick={() => updateParam("page", String(page + 1))}><ChevronRight /></button></div>
  </div>;
}

export function NewContentPage({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const categories = useAdminCategories();
  const [title, setTitle] = useState(""); const [categoryId, setCategoryId] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!categoryId && categories.data?.[0]) setCategoryId(categories.data[0].id); }, [categoryId, categories.data]);
  const create = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { const data = await saveContent({ slug: slugify(title), categoryId, title: title.trim(), summary: "", bodyHtml: "<p></p>", bodyJson: {}, bodyText: "", sourceRecord: "", status: "draft", featured: false, sortOrder: 100, tags: [] }, profile.id); navigate(`/admin/contents/${data.id}`, { replace: true }); } catch (error) { setMessage(messageOf(error, "草稿创建失败")); setSaving(false); } };
  return <div className="quick-create-page"><Link className="back-link" to="/admin/contents"><ArrowLeft />返回内容管理</Link><form className="quick-create" onSubmit={create}><span>NEW DRAFT</span><h1>创建资料草稿</h1><p>先建立标题和分类，下一步即可编辑正文并上传媒体。</p><label>资料标题<input required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入清晰、容易搜索的标题" /></label><label>所属分类<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{message && <div className="form-message">{message}</div>}<button className="button primary" disabled={saving || !title.trim() || !categoryId}>{saving ? <LoaderCircle className="spin" /> : <Plus />}{saving ? "正在创建..." : "创建并进入编辑器"}</button></form></div>;
}

export function ContentEditorPage({ profile }: { profile: Profile }) {
  const { id = "" } = useParams(); const navigate = useNavigate(); const client = useQueryClient();
  const content = useQuery({ queryKey: ["admin-content", id], queryFn: () => loadAdminContent(id), enabled: Boolean(id) });
  const categories = useAdminCategories();
  const [draft, setDraft] = useState<ContentDraft | null>(null); const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [messageError, setMessageError] = useState(false); const [tab, setTab] = useState<"body" | "media" | "preview">("body"); const [importUrl, setImportUrl] = useState(""); const [importing, setImporting] = useState(false); const [importProgress, setImportProgress] = useState(0); const [pendingImport, setPendingImport] = useState<{ preview: ImportPreview; file?: File } | null>(null); const [selectedSheets, setSelectedSheets] = useState<string[]>([]); const [importMode, setImportMode] = useState<"append" | "replace">("append"); const [importBackup, setImportBackup] = useState<ContentDraft | null>(null); const [recovery, setRecovery] = useState<ContentDraft | null>(null); const [importStage, setImportStage] = useState<DocumentImportStage | "upload-original" | "upload-webp" | "verify" | "complete" | "idle">("idle"); const [importJobId, setImportJobId] = useState(""); const [importFailure, setImportFailure] = useState(""); const loadedVersion = useRef<number | null>(null); const activeDocumentImport = useRef<{ id: string; assets: DocumentImportAsset[] } | null>(null);
  const storageKey = `maplestorynk-editor-${id}`;
  useEffect(() => { if (!content.data || loadedVersion.current === content.data.version) return; const item = content.data; loadedVersion.current = item.version; const initial: ContentDraft = { id: item.id, slug: item.slug, categoryId: item.categoryId, title: item.title, summary: item.summary, bodyHtml: item.bodyHtml, bodyJson: item.bodyJson, bodyText: item.bodyText, sourceRecord: item.sourceRecord, status: item.status, featured: item.featured, sortOrder: item.sortOrder, version: item.version, tags: item.tags }; setDraft(initial); setDirty(false); try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); if (saved?.version === item.version) setRecovery(saved); } catch { sessionStorage.removeItem(storageKey); } }, [content.data, storageKey]);
  useEffect(() => { if (!draft || !dirty) return; const timer = window.setTimeout(() => sessionStorage.setItem(storageKey, JSON.stringify(draft)), 600); return () => window.clearTimeout(timer); }, [draft, dirty, storageKey]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const update = (patch: Partial<ContentDraft>) => { setDraft((current) => current ? { ...current, ...patch } : current); setDirty(true); };
  const notify = (value: string, error = false) => { setMessage(value); setMessageError(error); };
  const importErrorMessage = (error: unknown) => {
    if (!(error instanceof DocumentImportError)) return messageOf(error, "导入或原文件上传失败");
    const stageText: Record<DocumentImportStage, string> = { start: "创建导入任务", finalize: "核验并提交图片", fail: "清理导入文件", cancel: "取消导入" };
    const status = error.status ? `（HTTP ${error.status}）` : "";
    if (error.code === "IMPORT_MANIFEST_INCOMPLETE") {
      const invalid = Array.isArray(error.details.invalid_asset_indexes) ? error.details.invalid_asset_indexes.join("、") : "";
      const duplicate = error.details.duplicate_media_ids ? "图片媒体编号重复" : "";
      const diagnostic = [invalid ? `无效图片序号：${invalid}` : "", duplicate].filter(Boolean).join("；");
      return `${stageText[error.stage]}失败${status}：${error.message}${diagnostic ? `（${diagnostic}）` : ""}`;
    }
    return `${stageText[error.stage]}失败${status}：${error.message}`;
  };
  const save = async () => { if (!draft) return null; setSaving(true); try { const result = await saveContent(draft, profile.id); loadedVersion.current = result.version; setDraft({ ...draft, version: result.version }); setDirty(false); sessionStorage.removeItem(storageKey); setRecovery(null); notify(result.tagWarning || "草稿已保存到云端。", Boolean(result.tagWarning)); client.invalidateQueries({ queryKey: ["admin-content-list"] }); return result; } catch (error) { notify(error instanceof Error && error.message === "VERSION_CONFLICT" ? "资料已被其他管理员修改，请重新载入后再编辑。" : messageOf(error, "保存失败"), true); return null; } finally { setSaving(false); } };
  const publish = async () => { if (!draft || !content.data) return; if (!draft.title.trim() || !draft.summary.trim() || !draft.categoryId || (!draft.bodyText.trim() && !content.data.media.length)) return notify("发布前请补齐标题、简介、分类以及正文或媒体。", true); const saved = dirty ? await save() : { version: draft.version }; if (!saved?.version) return; setSaving(true); try { await publishContent(id, saved.version); sessionStorage.removeItem(storageKey); notify("资料已发布。"); client.invalidateQueries({ queryKey: ["public-home"] }); client.invalidateQueries({ queryKey: ["public-category"] }); client.invalidateQueries({ queryKey: ["public-content"] }); client.invalidateQueries({ queryKey: ["admin-content-list"] }); await content.refetch(); } catch (error) { notify(messageOf(error, "发布失败"), true); } finally { setSaving(false); } };
  const goBack = () => { if (!dirty || window.confirm("存在未保存修改，确定离开编辑器吗？")) navigate("/admin/contents"); };
  const stageImport = (preview: ImportPreview, file?: File) => { setPendingImport({ preview, file }); setSelectedSheets(preview.worksheets?.[0] ? [preview.worksheets[0].name] : []); setImportMode(draft?.bodyText.trim() ? "append" : "replace"); notify(`已读取“${preview.title}”，确认后才会写入正文。`); };
  const importFile = async (file: File) => { setImporting(true); try { const { readDocument } = await import("../../lib/documents"); stageImport(await readDocument(file), file); } catch (error) { void reportRuntimeLog({ source: "document-import", message: messageOf(error, "文档读取失败"), error, context: { fileName: file.name, fileType: file.type, fileSize: file.size } }); notify(messageOf(error, "文档读取失败"), true); } finally { setImporting(false); } };
  const importPage = async () => { if (!importUrl.trim()) return; setImporting(true); try { const { readWebPage } = await import("../../lib/documents"); stageImport(await readWebPage(importUrl.trim())); } catch (error) { void reportRuntimeLog({ source: "web-import", message: messageOf(error, "网页读取失败"), error, context: { host: (() => { try { return new URL(importUrl).host; } catch { return "invalid"; } })() } }); notify(`${messageOf(error, "网页读取失败")}。腾讯文档请下载 Word 后导入。`, true); } finally { setImporting(false); } };
  const preserveOriginal = async (file: File) => {
    if (file.size > 100 * 1024 * 1024) return false;
    const path = `${profile.id}/${id}/source-${randomId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const stored = await uploadWithProgress(file, path, (value) => setImportProgress(value.percent));
    const { error } = await supabase.from("attachments").insert({ content_id: id, storage_bucket: stored.bucket, storage_path: stored.path, name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, sort_order: (content.data?.attachments.length || 0) * 10 + 10, created_by: profile.id });
    if (error) { await supabase.storage.from(stored.bucket).remove([stored.path]); throw error; }
    return true;
  };
  const uploadWordImage = async (image: ExtractedWordImage, total: number, job: { id: string; uploadPrefix: string }) => {
    const mediaId = randomId();
    const base = `${job.uploadPrefix}/${mediaId}`;
    const originalPath = `${base}-original.${image.extension}`;
    const displayPath = `${base}-lossless.webp`;
    const original = new File([image.original], `word-image-${image.index}.${image.extension}`, { type: image.mimeType });
    const display = new File([image.display], `word-image-${image.index}.webp`, { type: "image/webp" });
    const asset: DocumentImportAsset = {
      mediaId, originalPath, displayPath, hash: image.hash, mimeType: image.mimeType,
      width: image.width, height: image.height, originalSize: original.size, displaySize: display.size,
      sortOrder: ((content.data?.media.length || 0) + image.index) * 10,
      title: `图片 ${image.index}`, altText: `图片 ${image.index}`
    };
    activeDocumentImport.current?.assets.push(asset);
    setImportStage("upload-original");
    await uploadWithProgress(original, originalPath, (value) => setImportProgress(Math.round(((image.index - 1 + value.percent / 200) / total) * 100)), undefined, publicMediaBucket);
    setImportStage("upload-webp");
    await uploadWithProgress(display, displayPath, (value) => setImportProgress(Math.round(((image.index - 0.5 + value.percent / 200) / total) * 100)), undefined, publicMediaBucket);
    return { id: image.id, mediaId, displayUrl: publicAssetUrl(displayPath) };
  };
  const confirmImport = async () => {
    if (!pendingImport || !draft) return;
    const importSnapshot = pendingImport;
    const sourceFile = importSnapshot.file;
    const wordImages = importSnapshot.preview.wordImages;
    const imported = importSnapshot.preview.worksheets ? composeImportPreview(importSnapshot.preview.worksheets, selectedSheets) : importSnapshot.preview;
    if (!imported.bodyHtml.trim()) return notify("请至少选择一个有内容的工作表。", true);
    setImporting(true); setImportStage("start"); setImportJobId(""); setImportFailure("");
    let wordJob: { id: string; uploadPrefix: string } | null = null;
    try {
      let importedBody = imported;
      if (sourceFile?.name.toLowerCase().endsWith(".docx") && wordImages?.count) {
        if (!draft.version) throw new Error("资料版本缺失，请重新打开编辑器后导入");
        wordJob = await startDocumentImport({ contentId: id, expectedVersion: draft.version, expectedImages: wordImages.count, totalOriginalBytes: wordImages.totalOriginalBytes });
        setImportJobId(wordJob.id);
        activeDocumentImport.current = { id: wordJob.id, assets: [] };
        const { materializeWordDocument } = await import("../../lib/documents");
        const materializedWord = await materializeWordDocument(
          sourceFile,
          async (image) => {
            return uploadWordImage(image, wordImages.count, wordJob!);
          },
          (current) => notify(`正在无损处理 Word 图片 ${current}/${wordImages.count}`)
        );
        importedBody = materializedWord;
        const uploadedAssets = activeDocumentImport.current?.assets || [];
        if (materializedWord.imageCount !== wordImages.count || uploadedAssets.length !== wordImages.count) {
          throw new Error(`Word 图片处理未完成：识别 ${wordImages.count} 张，正文生成 ${materializedWord.imageCount} 张，已上传 ${uploadedAssets.length} 张。`);
        }
      }
      setImportBackup(draft);
      const bodyHtml = sanitizeHtml(importMode === "append" && draft.bodyText.trim() ? `${draft.bodyHtml}<hr>${importedBody.bodyHtml}` : importedBody.bodyHtml);
      const bodyText = new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent || importedBody.bodyText;
      const sourceRecord = [draft.sourceRecord, importSnapshot.preview.source].filter(Boolean).join("\n");
      if (wordJob && activeDocumentImport.current) {
        setImportStage("verify");
        const finalized = await finalizeDocumentImport({ importId: wordJob.id, expectedVersion: draft.version || 1, bodyHtml, sourceRecord, assets: activeDocumentImport.current.assets });
        const nextDraft = { ...draft, title: draft.title || importSnapshot.preview.title, bodyHtml, bodyText, bodyJson: {}, sourceRecord, version: finalized.version };
        loadedVersion.current = finalized.version;
        setDraft(nextDraft); setDirty(false); sessionStorage.removeItem(storageKey); setRecovery(null);
        activeDocumentImport.current = null;
        if (sourceFile && sourceFile.size <= 100 * 1024 * 1024) {
          try { await preserveOriginal(sourceFile); } catch (attachmentError) { void reportRuntimeLog({ source: "document-import-attachment", message: messageOf(attachmentError, "原始 Word 附件保存失败"), error: attachmentError, context: { fileName: sourceFile.name, fileSize: sourceFile.size } }); }
        }
        await content.refetch();
        client.invalidateQueries({ queryKey: ["admin-content-list"] });
        client.invalidateQueries({ queryKey: ["admin-media", id] });
        setImportStage("complete");
        notify(`已安全保存正文和 ${finalized.imported_images}/${wordImages?.count || 0} 张无损图片。`);
      } else {
        update({ title: draft.title || importSnapshot.preview.title, bodyHtml, bodyText, bodyJson: {}, sourceRecord });
        notify(importSnapshot.preview.warning || `已导入“${importSnapshot.preview.title}”，保存草稿后正式生效。`);
      }
      setPendingImport(null); setImportUrl("");
    } catch (error) {
      const failureMessage = importErrorMessage(error);
      const uploadedImages = activeDocumentImport.current?.assets.length || 0;
      if (activeDocumentImport.current) void cancelDocumentImport(activeDocumentImport.current.id, activeDocumentImport.current.assets, failureMessage);
      activeDocumentImport.current = null;
      const details = error instanceof DocumentImportError ? error.details : {};
      setImportFailure(failureMessage);
      void reportRuntimeLog({ source: "document-import", message: failureMessage, error, context: { contentId: id, fileName: sourceFile?.name, imageCount: wordImages?.count, importJobId: error instanceof DocumentImportError ? String(details.import_id || importJobId) : importJobId, importStage: error instanceof DocumentImportError ? error.stage : importStage, httpStatus: error instanceof DocumentImportError ? error.status : null, errorCode: error instanceof DocumentImportError ? error.code : null, missingCount: Number(details.missing_count || 0), invalidAssetIndexes: Array.isArray(details.invalid_asset_indexes) ? details.invalid_asset_indexes.join(",") : "", manifestDiagnostics: Array.isArray(details.invalid_assets) ? JSON.stringify(details.invalid_assets).slice(0, 500) : "", uploadedImages } });
      notify(failureMessage, true);
    }
    finally { setImporting(false); setImportProgress(0); }
  };
  const uploadInlineImages = async (files: File[]) => {
    const uploaded: Array<{ src: string; alt: string; caption?: string }> = [];
    try {
      for (const [index, file] of files.entries()) {
        if (!file.type.startsWith("image/")) throw new Error("正文中只能直接插入图片文件。");
        validateUpload(file);
        const prepared = await imageToWebp(file);
        const path = `inline/${id}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        await uploadWithProgress(prepared, path, (value) => setImportProgress(Math.round(((index + value.percent / 100) / files.length) * 100)), undefined, publicMediaBucket);
        const name = file.name.replace(/\.[^.]+$/, "");
        uploaded.push({ src: publicAssetUrl(path), alt: name });
      }
      notify(`已上传并插入 ${uploaded.length} 张图片。`);
      return uploaded;
    } finally {
      setImportProgress(0);
    }
  };
  if (content.error) return <div className="admin-error"><Database /><h1>资料读取失败</h1><p>{messageOf(content.error)}</p><button className="button" onClick={() => content.refetch()}><RefreshCcw />重新读取</button></div>;
  if (content.isLoading || !draft || !content.data) return <AdminLoading label="正在打开编辑工作区" />;
  if (!canEditItem(profile, content.data)) return <div className="admin-error"><Eye /><h1>仅可查看</h1><p>上传管理员只能编辑自己创建的草稿。</p><button className="button" onClick={() => navigate("/admin/contents")}>返回内容管理</button></div>;
  return <div className="content-workspace"><AdminToast message={message} error={messageError} onClose={() => setMessage("")} /><header className="workspace-header"><button className="icon-only" type="button" onClick={goBack}><ArrowLeft /></button><div className="workspace-title"><span><StatusBadge status={content.data.status} /> 版本 {draft.version}{dirty && " · 有未保存修改"}</span><h1>{draft.title || "未命名资料"}</h1></div><div className="workspace-actions"><button className="button quiet" type="button" onClick={() => setTab(tab === "preview" ? "body" : "preview")}><Eye />{tab === "preview" ? "返回编辑" : "预览"}</button><button className="button" disabled={saving || !dirty} type="button" onClick={save}><Save />保存草稿</button>{canPublish(profile.role) && <button className="button primary" disabled={saving} type="button" onClick={publish}><Check />发布</button>}</div></header>
    {recovery && <div className="recovery-banner"><div><strong>发现未提交的本地修改</strong><span>可恢复上次关闭前的编辑内容。</span></div><button onClick={() => { setDraft(recovery); setDirty(true); setRecovery(null); }}>恢复</button><button onClick={() => { sessionStorage.removeItem(storageKey); setRecovery(null); }}>忽略</button></div>}
    <div className="workspace-tabs"><button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}><FileText />正文</button><button className={tab === "media" ? "active" : ""} onClick={() => setTab("media")}><FileImage />媒体与附件 <span>{content.data.media.length + content.data.attachments.length}</span></button><button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}><Eye />阅读预览</button></div>
    <div className="workspace-body"><main className="workspace-main">{tab === "body" && <><section className="import-strip"><label><FileText /><span>导入 Word / Excel / TXT / Markdown</span><input type="file" accept=".docx,.xlsx,.xls,.txt,.md,.html" disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ""; }} /></label><div><Link2 /><input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="粘贴网页链接" /><button disabled={importing} type="button" onClick={importPage}>{importing ? "读取中" : "读取"}</button></div></section>{pendingImport && <ImportConfirmation preview={pendingImport.preview} selectedSheets={selectedSheets} onSelectedSheets={setSelectedSheets} mode={importMode} onMode={setImportMode} progress={importProgress} busy={importing} stage={importStage} jobId={importJobId} failure={importFailure} onConfirm={confirmImport} onCancel={() => { setPendingImport(null); setImportStage("idle"); setImportJobId(""); setImportFailure(""); }} />}{importBackup && <div className="import-undo-banner"><span>已将导入内容放入编辑器，尚未保存到云端。</span><button type="button" onClick={() => { setDraft(importBackup); setDirty(true); setImportBackup(null); notify("已恢复导入前正文。"); }}>撤销本次导入</button><button type="button" className="icon-only" aria-label="关闭撤销提示" onClick={() => setImportBackup(null)}><X /></button></div>}<Suspense fallback={<AdminLoading label="正在加载专业编辑器" />}><RichEditor value={draft.bodyHtml} onUploadImages={uploadInlineImages} onChange={(bodyHtml, bodyText, bodyJson) => update({ bodyHtml, bodyText, bodyJson })} /></Suspense></>}
      {tab === "media" && <ContentMediaManager contentId={id} profile={profile} onChanged={async () => { await content.refetch(); client.invalidateQueries({ queryKey: ["admin-content-list"] }); }} />}
      {tab === "preview" && <DraftPreview draft={draft} item={content.data} />}</main>
      <aside className="workspace-inspector"><div className="inspector-heading"><span>CONTENT SETTINGS</span><h2>资料属性</h2></div><label>标题<input value={draft.title} onChange={(event) => update({ title: event.target.value })} /></label><label>简介<textarea value={draft.summary} onChange={(event) => update({ summary: event.target.value })} placeholder="用于列表和搜索结果" /></label><label>分类<select value={draft.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><div className="inspector-grid"><label>排序<input type="number" value={draft.sortOrder} onChange={(event) => update({ sortOrder: Number(event.target.value) })} /></label><label>路径<input value={draft.slug} onChange={(event) => update({ slug: slugify(event.target.value) })} /></label></div><label>标签<input value={draft.tags.join(", ")} onChange={(event) => update({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20) })} placeholder="BOSS图, 城镇图" /></label><label>来源记录<textarea value={draft.sourceRecord} onChange={(event) => update({ sourceRecord: event.target.value })} placeholder="仅后台可见" /></label>{canPublish(profile.role) && <label className="checkbox"><input type="checkbox" checked={draft.featured} onChange={(event) => update({ featured: event.target.checked })} />首页精选</label>}</aside></div>
  </div>;
}

function ImportConfirmation({ preview, selectedSheets, onSelectedSheets, mode, onMode, progress, busy, stage, jobId, failure, onConfirm, onCancel }: { preview: ImportPreview; selectedSheets: string[]; onSelectedSheets(value: string[]): void; mode: "append" | "replace"; onMode(value: "append" | "replace"): void; progress: number; busy: boolean; stage: DocumentImportStage | "upload-original" | "upload-webp" | "verify" | "complete" | "idle"; jobId: string; failure: string; onConfirm(): void; onCancel(): void }) {
  const composed = preview.worksheets ? composeImportPreview(preview.worksheets, selectedSheets) : preview;
  const toggleSheet = (name: string, checked: boolean) => onSelectedSheets(checked ? [...selectedSheets, name] : selectedSheets.filter((item) => item !== name));
  const steps: Array<[typeof stage, string]> = [["start", "创建任务"], ["upload-original", "上传原图"], ["upload-webp", "上传无损 WebP"], ["verify", "核验图片"], ["finalize", "提交正文"]];
  const activeIndex = steps.findIndex(([key]) => key === stage);
  return <section className="import-confirmation">
    <header><div><span>{preview.kind === "workbook" ? "EXCEL PREVIEW" : preview.kind === "web" ? "WEB PREVIEW" : "DOCUMENT PREVIEW"}</span><h2>{preview.title}</h2><p>{preview.warning || "检查内容后再确认导入。"}</p></div><button className="icon-only" type="button" aria-label="取消导入" onClick={onCancel}><X /></button></header>
    {preview.worksheets && <div className="worksheet-picker">{preview.worksheets.map((sheet) => <label key={sheet.name}><input type="checkbox" checked={selectedSheets.includes(sheet.name)} onChange={(event) => toggleSheet(sheet.name, event.target.checked)} /><span><strong>{sheet.name}</strong><small>{sheet.rowCount} 行 · {sheet.columnCount} 列</small></span></label>)}</div>}
    <div className="import-mode"><span>写入方式</span><button type="button" className={mode === "append" ? "active" : ""} onClick={() => onMode("append")}>追加到正文</button><button type="button" className={mode === "replace" ? "active" : ""} onClick={() => onMode("replace")}>替换正文</button></div>
    <div className="import-preview-scroll"><RichContent html={composed.bodyHtml} className="reader-body import-preview-body" /></div>
    {preview.wordImages && <div className="word-import-summary"><strong>{preview.wordImages.count} 张原图</strong><span>{formatBytes(preview.wordImages.totalOriginalBytes)} · 原图与像素无损 WebP 双份保存</span></div>}
    {preview.wordImages && <div className="document-import-status" aria-live="polite"><div>{steps.map(([key, label], index) => <span className={stage === "complete" || (activeIndex >= index && activeIndex !== -1) ? "done" : ""} key={key}>{label}</span>)}</div>{jobId && <small>导入任务：{jobId}</small>}{failure && <p role="alert">{failure}</p>}</div>}
    {progress > 0 && <div className="upload-progress"><span style={{ width: `${progress}%` }} /><strong>正在无损处理并上传图片 {progress}%</strong></div>}
    <footer><span>{preview.kind === "web" ? "网页来源会记录在后台" : preview.wordImages && preview.wordImages.totalOriginalBytes > 100 * 1024 * 1024 ? "正文和图片会保存，超限的原始 Word 不保存为附件" : "确认后原文件会同时保存为私有附件"}</span><button className="button quiet" type="button" disabled={busy} onClick={onCancel}>取消</button><button className="button primary" type="button" disabled={busy || Boolean(preview.worksheets && !selectedSheets.length)} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Check />}{busy ? "正在导入" : "确认导入"}</button></footer>
  </section>;
}

function DraftPreview({ draft, item }: { draft: ContentDraft; item: ContentItem }) {
  return <article className="draft-preview"><header><span>{item.categoryName}</span><h1>{draft.title}</h1><p>{draft.summary}</p></header><RichContent html={draft.bodyHtml} />{item.media.map((media) => <PreviewMedia key={media.id} media={media} />)}</article>;
}

function PreviewMedia({ media }: { media: ContentItem["media"][number] }) {
  return <figure>{media.kind === "video" ? <div className="media-video-shell"><VideoPlayer media={media} /></div> : <img src={media.src} alt={media.altText || media.title} />}<figcaption><strong>{media.title}</strong>{media.note && <p>{media.note}</p>}</figcaption></figure>;
}

type MediaRow = Record<string, unknown> & { id: string; storage_bucket: string | null; storage_path: string | null; external_url: string | null; mime_type?: string | null; previewUrl?: string };

async function loadMediaRecords(contentId: string) {
  const [media, attachments] = await Promise.all([supabase.from("content_media").select("*").eq("content_id", contentId).order("sort_order"), supabase.from("attachments").select("*").eq("content_id", contentId).order("sort_order")]);
  if (media.error) throw media.error; if (attachments.error) throw attachments.error;
  const withUrls = await Promise.all((media.data || []).map(async (row) => {
    let previewUrl = row.external_url || "";
    if (row.storage_bucket === publicMediaBucket && row.storage_path) previewUrl = publicAssetUrl(row.storage_path);
    if (row.storage_bucket === privateMediaBucket && row.storage_path) previewUrl = (await supabase.storage.from(privateMediaBucket).createSignedUrl(row.storage_path, 3600)).data?.signedUrl || "";
    return { ...row, previewUrl } as MediaRow;
  }));
  return { media: withUrls, attachments: (attachments.data || []) as MediaRow[] };
}

export function ContentMediaManager({ contentId, profile, onChanged }: { contentId: string; profile: Profile; onChanged(): void | Promise<void> }) {
  const client = useQueryClient(); const records = useQuery({ queryKey: ["admin-media", contentId], queryFn: () => loadMediaRecords(contentId), enabled: Boolean(contentId) });
  const [progress, setProgress] = useState(0); const [uploadStage, setUploadStage] = useState(""); const [message, setMessage] = useState(""); const [errorState, setErrorState] = useState(false); const controller = useRef<AbortController | null>(null); const [dragging, setDragging] = useState<string | null>(null);
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["admin-media", contentId] }); await onChanged(); };
  const notify = (value: string, error = false) => { setMessage(value); setErrorState(error); };
  const upload = async (files: File[]) => {
    controller.current = new AbortController();
    try {
      for (const [index, file] of files.entries()) {
        const type = validateUpload(file);
        let prepared = type.image ? await imageToWebp(file) : file;
        if (type.video) {
          setUploadStage(`正在上传视频到云点播 ${index + 1}/${files.length}`);
          const { saveVodMedia, uploadVideoToVod } = await import("../../lib/vod");
          const upload = await uploadVideoToVod(file, (value) => setProgress(Math.round(((index + value / 100) / files.length) * 100)));
          await saveVodMedia({ contentId, file, upload, sortOrder: ((records.data?.media.length || 0) + index + 1) * 10 });
          continue;
        }
        setUploadStage(`正在上传 ${index + 1}/${files.length}`);
        const path = `${profile.id}/${contentId}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const stored = await uploadWithProgress(prepared, path, (value) => setProgress(Math.round(((index + value.percent / 100) / files.length) * 100)), controller.current.signal, privateMediaBucket);
        const base = { content_id: contentId, storage_bucket: stored.bucket, storage_path: stored.path, sort_order: ((records.data?.media.length || 0) + index + 1) * 10, created_by: profile.id, mime_type: prepared.type || "application/octet-stream", size_bytes: prepared.size };
        const dimensions = type.image ? await imageDimensions(prepared) : {};
        const result = type.document
          ? await supabase.from("attachments").insert({ ...base, name: file.name })
          : await supabase.from("content_media").insert({ ...base, kind: "image", title: file.name.replace(/\.[^.]+$/, ""), alt_text: file.name, processing_status: "ready", ...dimensions });
        if (result.error) { await supabase.storage.from(stored.bucket).remove([stored.path]); throw result.error; }
      }
      notify(`已上传 ${files.length} 个文件。`);
      await refresh();
    } catch (error) {
      void reportRuntimeLog({ source: "upload", message: messageOf(error, "上传失败"), error, context: { contentId, fileCount: files.length } });
      notify(error instanceof DOMException && error.name === "AbortError" ? "上传已取消。" : messageOf(error, "上传失败"), true);
    } finally { controller.current = null; setProgress(0); setUploadStage(""); }
  };
  const remove = async (table: "content_media" | "attachments", row: MediaRow) => {
    if (!window.confirm("确定删除这个文件吗？此操作无法撤销。")) return;
    const key = ["admin-media", contentId];
    const previous = client.getQueryData<{ media: MediaRow[]; attachments: MediaRow[] }>(key);
    client.setQueryData<{ media: MediaRow[]; attachments: MediaRow[] }>(key, (current) => current ? { ...current, [table === "content_media" ? "media" : "attachments"]: current[table === "content_media" ? "media" : "attachments"].filter((item) => item.id !== row.id) } : current);
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) { client.setQueryData(key, previous); return notify(error.message, true); }
    notify("文件已删除，存储文件正在后台清理。");
    void onChanged();
    const storedPaths = [row.storage_path, row.original_storage_path, row.display_storage_path].filter(Boolean).map(String);
    if (row.storage_bucket && storedPaths.length) void supabase.storage.from(row.storage_bucket).remove([...new Set(storedPaths)]).then(({ error: storageError }) => {
      if (storageError) void reportRuntimeLog({ source: "storage-cleanup", message: storageError.message, context: { table, recordId: row.id } });
    });
  };
  const reorder = async (targetId: string) => { if (!dragging || dragging === targetId || !records.data) return; const rows = [...records.data.media]; const from = rows.findIndex((row) => row.id === dragging); const to = rows.findIndex((row) => row.id === targetId); const [moved] = rows.splice(from, 1); rows.splice(to, 0, moved); setDragging(null); try { await Promise.all(rows.map((row, index) => supabase.from("content_media").update({ sort_order: (index + 1) * 10 }).eq("id", row.id).then(({ error }) => { if (error) throw error; }))); notify("媒体顺序已保存。"); refresh(); } catch (error) { notify(messageOf(error, "排序失败"), true); } };
  if (records.isLoading) return <AdminLoading label="正在读取媒体" />;
  return <div className="media-workspace"><AdminToast message={message} error={errorState} onClose={() => setMessage("")} /><label className="drop-zone"><Upload /><strong>批量上传图片、视频或附件</strong><span>图片自动转 WebP；视频直接上传腾讯云点播并使用内嵌播放器</span><b>选择本地文件</b><input className="visually-hidden-file" type="file" multiple accept="image/*,video/*,.pdf,.zip,.docx,.txt" disabled={!canEdit(profile.role) || Boolean(controller.current)} onChange={(event) => { const files = [...(event.target.files || [])]; if (files.length) upload(files); event.target.value = ""; }} /></label>{progress > 0 && <div className="upload-progress"><span style={{ width: `${progress}%` }} /><strong>{uploadStage || `${progress}%`}</strong></div>}
    <div className="media-library-grid">{records.data?.media.map((row) => <MediaCard key={row.id} row={row} editable={canEdit(profile.role)} dragging={dragging === row.id} onDrag={() => setDragging(row.id)} onDrop={() => reorder(row.id)} onSaved={refresh} onRemove={() => remove("content_media", row)} onMessage={notify} />)}{!records.data?.media.length && <AdminEmpty icon={<ImagePlus />} title="暂无图片或视频" detail="上传后可编辑名称、标注和多级路径。" />}</div>
    <section className="attachment-section"><div className="panel-heading"><div><h2>附件</h2><p>Word、PDF、压缩包和文本文件</p></div></div>{records.data?.attachments.map((row) => <div className="attachment-row" key={row.id}><FileText /><div><strong>{String(row.name || "附件")}</strong><span>{String(row.mime_type || "文件")} · {formatBytes(Number(row.size_bytes || 0))}</span></div>{canEdit(profile.role) && <button className="icon-only danger" onClick={() => remove("attachments", row)}><Trash2 /></button>}</div>)}{!records.data?.attachments.length && <AdminEmpty title="暂无附件" />}</section></div>;
}

function MediaCard({ row, editable, dragging, onDrag, onDrop, onSaved, onRemove, onMessage }: { row: MediaRow; editable: boolean; dragging: boolean; onDrag(): void; onDrop(): void; onSaved(): void; onRemove(): void; onMessage(value: string, error?: boolean): void }) {
  const [title, setTitle] = useState(String(row.title || "")); const [note, setNote] = useState(String(row.note || "")); const [path, setPath] = useState(Array.isArray(row.hierarchy_path) ? row.hierarchy_path.join(" / ") : "");
  const [converting, setConverting] = useState(false);
  const save = async () => { const { error } = await supabase.from("content_media").update({ title: title.trim(), note: note.trim(), hierarchy_path: path.split("/").map((part) => part.trim()).filter(Boolean), alt_text: title.trim() }).eq("id", row.id); if (error) onMessage(error.message, true); else { onMessage("媒体信息已保存。"); onSaved(); } };
  const repairVideo = async () => {
    if (!row.previewUrl || row.kind !== "video") return;
    setConverting(true);
    try {
      const { importExistingVideo, refreshVodStatus } = await import("../../lib/vod");
      await importExistingVideo(row.id, row.previewUrl);
      let status: "processing" | "ready" | "failed" = "processing";
      for (let attempt = 0; attempt < 24 && status === "processing"; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        status = (await refreshVodStatus(row.id)).status;
      }
      onMessage(status === "ready" ? "视频已迁移到云点播播放器。" : status === "failed" ? "腾讯云处理失败，请查看运行日志。" : "视频仍在云端处理中，稍后刷新状态即可。", status === "failed");
      await onSaved();
    } catch (error) {
      void reportRuntimeLog({ source: "video-vod", message: messageOf(error, "视频迁移失败"), error, context: { mediaId: row.id } });
      onMessage(messageOf(error, "视频迁移失败"), true);
    } finally { setConverting(false); }
  };
  const checkVod = async () => {
    setConverting(true);
    try {
      const { refreshVodStatus } = await import("../../lib/vod");
      const result = await refreshVodStatus(row.id);
      onMessage(result.status === "ready" ? "云点播视频已可以播放。" : result.status === "failed" ? result.error || "云端处理失败。" : "视频仍在云端处理中。", result.status === "failed");
      await onSaved();
    } catch (error) { onMessage(messageOf(error, "视频状态查询失败"), true); }
    finally { setConverting(false); }
  };
  const playerMedia = { src: String(row.previewUrl || ""), title, mimeType: String(row.mime_type || ""), processingStatus: String(row.processing_status || "ready") as "ready" | "processing" | "failed", videoProvider: row.video_provider === "tencent_vod" ? "tencent_vod" as const : undefined, providerFileId: row.provider_file_id ? String(row.provider_file_id) : undefined, providerAppId: row.provider_app_id ? String(row.provider_app_id) : undefined };
  return <article className={`media-card${dragging ? " dragging" : ""}`} draggable={editable} onDragStart={onDrag} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}><div className="media-card-preview">{row.kind === "video" ? <div className="media-video-shell"><VideoPlayer media={playerMedia} />{editable && row.video_provider !== "tencent_vod" && <button type="button" className="button quiet vod-migrate-button" disabled={converting} onClick={repairVideo}>{converting ? <LoaderCircle className="spin" /> : <RefreshCcw />}迁移到云点播</button>}{editable && row.video_provider === "tencent_vod" && row.processing_status === "processing" && <button type="button" className="button quiet vod-migrate-button" disabled={converting} onClick={checkVod}>{converting ? <LoaderCircle className="spin" /> : <RefreshCcw />}刷新处理状态</button>}</div> : row.previewUrl ? <img src={row.previewUrl} alt={title} /> : <FileImage />}</div><div className="media-card-fields"><input disabled={!editable} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="图片名称" /><input disabled={!editable} value={path} onChange={(event) => setPath(event.target.value)} placeholder="一级 / 二级 / 三级" /><textarea disabled={!editable} value={note} onChange={(event) => setNote(event.target.value)} placeholder="图片标注或说明" /></div>{editable && <div className="media-card-actions"><span>拖动排序</span><button title="保存" onClick={save}><Save /></button><button className="danger" title="删除" onClick={onRemove}><Trash2 /></button></div>}</article>;
}

export function CategoriesPage({ profile }: { profile: Profile }) {
  const client = useQueryClient(); const categories = useAdminCategories(); const contents = useQuery({ queryKey: ["admin-content-list"], queryFn: loadAdminContentList, staleTime: 30_000 });
  const [message, setMessage] = useState(""); const [errorState, setErrorState] = useState(false); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [dragging, setDragging] = useState<string | null>(null);
  const refresh = () => { client.invalidateQueries({ queryKey: ["admin-categories"] }); client.invalidateQueries({ queryKey: ["public-home"] }); client.invalidateQueries({ queryKey: ["public-category"] }); };
  const notify = (value: string, error = false) => { setMessage(value); setErrorState(error); };
  const create = async (event: React.FormEvent) => { event.preventDefault(); const { error } = await supabase.from("categories").insert({ name: name.trim(), slug: slugify(name), description, sort_order: ((categories.data?.length || 0) + 1) * 10, created_by: profile.id, updated_by: profile.id }); if (error) return notify(error.message, true); setName(""); setDescription(""); notify("分类已创建。"); refresh(); };
  const reorder = async (targetId: string) => { if (!dragging || dragging === targetId || !categories.data) return; const rows = [...categories.data]; const from = rows.findIndex((row) => row.id === dragging); const to = rows.findIndex((row) => row.id === targetId); const [moved] = rows.splice(from, 1); rows.splice(to, 0, moved); setDragging(null); try { await Promise.all(rows.map((row, index) => supabase.from("categories").update({ sort_order: (index + 1) * 10, updated_by: profile.id }).eq("id", row.id).then(({ error }) => { if (error) throw error; }))); notify("分类顺序已保存。"); refresh(); } catch (error) { notify(messageOf(error, "排序失败"), true); } };
  return <div className="admin-page-stack"><AdminToast message={message} error={errorState} onClose={() => setMessage("")} /><header className="admin-page-heading"><div><span>CATALOG STRUCTURE</span><h1>分类管理</h1><p>拖动排序，管理封面、文字和显示状态。</p></div></header>{canPublish(profile.role) && <form className="admin-inline-create" onSubmit={create}><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="新分类名称" /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="分类说明" /><button className="button primary"><Plus />创建分类</button></form>}<section className="category-manager">{categories.data?.map((category) => <CategoryManagerRow key={category.id} category={category} count={(contents.data || []).filter((item) => item.categoryId === category.id && item.status !== "trashed").length} profile={profile} dragging={dragging === category.id} onDrag={() => setDragging(category.id)} onDrop={() => reorder(category.id)} onSaved={refresh} onMessage={notify} />)}{!categories.data?.length && <AdminEmpty title="尚未创建分类" />}</section></div>;
}

function CategoryManagerRow({ category, count, profile, dragging, onDrag, onDrop, onSaved, onMessage }: { category: Category; count: number; profile: Profile; dragging: boolean; onDrag(): void; onDrop(): void; onSaved(): void; onMessage(value: string, error?: boolean): void }) {
  const [name, setName] = useState(category.name); const [description, setDescription] = useState(category.description); const [uploading, setUploading] = useState(false); const editable = canPublish(profile.role);
  const save = async (patch: Record<string, unknown>) => { const { error } = await supabase.from("categories").update({ ...patch, updated_by: profile.id }).eq("id", category.id); if (error) onMessage(error.message, true); else { onMessage("分类已保存。"); onSaved(); } };
  const upload = async (file: File) => { setUploading(true); try { const prepared = await imageToWebp(file); const path = `categories/${category.id}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; await uploadWithProgress(prepared, path, () => undefined, undefined, publicMediaBucket); await save({ image_path: path }); } catch (error) { onMessage(messageOf(error, "封面上传失败"), true); } finally { setUploading(false); } };
  const remove = async () => { if (count > 0) return onMessage("请先移动或删除分类中的资料。", true); if (!window.confirm(`确定删除空分类“${category.name}”吗？`)) return; const { error } = await supabase.from("categories").delete().eq("id", category.id); if (error) onMessage(error.message, true); else { onMessage("分类已删除。"); onSaved(); } };
  return <article className={`category-manager-row${dragging ? " dragging" : ""}`} draggable={editable} onDragStart={onDrag} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}><div className="category-manager-cover">{category.imageUrl ? <img src={category.imageUrl} alt="" /> : <FolderOpen />}</div><div className="category-manager-fields"><input disabled={!editable} value={name} onChange={(event) => setName(event.target.value)} /><textarea disabled={!editable} value={description} onChange={(event) => setDescription(event.target.value)} /></div><div className="category-manager-meta"><strong>{count}</strong><span>篇资料</span><small>拖动排序</small></div>{editable && <div className="category-manager-actions"><label className="button quiet"><ImagePlus />{uploading ? "上传中" : "替换封面"}<input type="file" accept="image/*" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /></label><button className={`status ${category.visible ? "published" : "hidden"}`} onClick={() => save({ is_visible: !category.visible })}>{category.visible ? "显示" : "隐藏"}</button><button className="icon-only" onClick={() => save({ name: name.trim(), slug: slugify(name), description })}><Save /></button>{profile.role === "super_admin" && <button className="icon-only danger" onClick={remove}><Trash2 /></button>}</div>}</article>;
}

export function MediaLibraryPage({ profile }: { profile: Profile }) {
  const contents = useQuery({ queryKey: ["admin-content-list"], queryFn: loadAdminContentList, staleTime: 30_000 }); const [contentId, setContentId] = useState("");
  const eligible = (contents.data || []).filter((item) => item.status !== "trashed" && (profile.role !== "uploader" || (item.status === "draft" && item.createdBy === profile.id)));
  return <div className="admin-page-stack"><header className="admin-page-heading"><div><span>MEDIA LIBRARY</span><h1>媒体与附件</h1><p>按资料管理图片、视频和下载文件。</p></div></header><div className="media-content-picker"><label>选择资料<Search /><select value={contentId} onChange={(event) => setContentId(event.target.value)}><option value="">请选择一篇资料</option>{eligible.map((item) => <option value={item.id} key={item.id}>{item.title} · {statusText[item.status]}</option>)}</select></label>{contentId && <Link to={`/admin/contents/${contentId}`}>进入完整编辑器<ChevronRight /></Link>}</div>{contentId ? <ContentMediaManager contentId={contentId} profile={profile} onChanged={() => undefined} /> : <AdminEmpty icon={<Layers3 />} title="选择资料后管理媒体" detail="媒体会与资料状态一起发布或保持私有。" />}</div>;
}
