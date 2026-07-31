import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight,
  Copy, Database, Eye, FileImage, FilePenLine, FileText, FolderOpen, Gauge, ImagePlus,
  Link2, LoaderCircle, Plus, RefreshCcw, Save, Search, Trash2, Upload, X
} from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { RichContent } from "../../components/RichContent";
import { AppErrorBoundary } from "../../components/AppErrorBoundary";
import type { RichEditorHandle, RichEditorMedia, RichEditorSnapshot } from "../../components/RichEditor";
import { VideoPlayer } from "../../components/VideoPlayer";
import { cosPrivateBucket, cosPublicBucket, cosStorageEnabled, mediaBaseUrl, privateMediaBucket, publicMediaBucket, supabasePublishableKey, supabaseUrl } from "../../lib/config";
import type { ImportPreview, WorksheetPreview, WordImportProgress, WordUploadSession } from "../../lib/documents";
import { randomId } from "../../lib/id";
import {
  batchContent, cancelDocumentImport, changeContentStatus, cleanupDocumentImportMedia, deleteContentForever, duplicateContent, finalizeDocumentImport,
  getDocumentImportStatus, listDocumentImports, loadAdminCategoryCounts, loadAdminContent, loadAdminContentPage, loadAdminDashboardPending, loadAdminDashboardSummary, loadAdminEmbeddedMedia, logDocumentImportEvent, publishContent,
  retryDocumentImport, saveContent, startDocumentImport, DocumentImportError, type DocumentImportAsset, type DocumentImportStage
} from "../../lib/repository";
import { reportRuntimeLog } from "../../lib/runtimeLogs";
import { clearEditorRecovery, readEditorRecovery, saveEditorRecovery } from "../../lib/editorRecovery";
import { EdgeFunctionError, invokeEdgeFunction } from "../../lib/edgeFunctions";
import { CosUploadError } from "../../lib/cosUpload";
import { prepareBrowserVideo, type BrowserVideoProgress } from "../../lib/browserVideoTranscode";
import { referencedMediaIds, removeMediaFigureHtml } from "../../lib/richMedia";
import { sanitizeHtml, slugify } from "../../lib/sanitize";
import { supabase } from "../../lib/supabase";
import { removeStoredObjects } from "../../lib/storage";
import { imageDimensions, imageToWebp, imageToWebpVariant, normalizedVideoMimeType, uploadManagedFile, validateUpload } from "../../lib/uploads";
import type { Category, ContentDraft, ContentItem, ContentMedia, ContentStatus, Profile } from "../../types";
import {
  AdminEmpty, AdminLoading, AdminPageHeader, AdminToast, canEdit, canEditItem, canPublish, formatBytes,
  formatDate, messageOf, publicAssetUrl, roleText, StatusBadge, statusText, useAdminCategories
} from "./shared";

const pageSize = 20;
type EditorImportStage = DocumentImportStage | "upload-original" | "verify" | "complete" | "idle";
const RichEditor = lazy(() => import("../../components/RichEditor").then((module) => ({ default: module.RichEditor })));
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function composeImportPreview(worksheets: WorksheetPreview[], selectedNames: string[]) {
  const selected = worksheets.filter((sheet) => selectedNames.includes(sheet.name));
  const bodyHtml = sanitizeHtml(selected.map((sheet) => `<h2>${escapeHtml(sheet.name)}</h2>${sheet.bodyHtml}`).join(""));
  return { bodyHtml, bodyText: selected.map((sheet) => `${sheet.name}\n${sheet.bodyText}`).join("\n\n") };
}

function browserVideoStageText(progress: BrowserVideoProgress) {
  return ({
    checking: "正在检查视频画面",
    loading: "首次加载本地转换组件",
    transcoding: "正在本机转换为 H.264/AAC",
    poster: "正在生成视频封面",
    verifying: "正在验证转换结果"
  } as Record<BrowserVideoProgress["stage"], string>)[progress.stage];
}

function videoPosterPath(videoPath: string) {
  return `${videoPath.replace(/\.[^.\/]+$/, "")}-poster.webp`;
}

export function DashboardPage({ profile }: { profile: Profile }) {
  const contents = useQuery({ queryKey: ["admin-dashboard-pending"], queryFn: loadAdminDashboardPending, staleTime: 60_000 });
  const summary = useQuery({ queryKey: ["admin-dashboard-summary"], queryFn: loadAdminDashboardSummary, staleTime: 60_000 });
  const logs = useQuery({ queryKey: ["dashboard-logs"], queryFn: async () => {
    const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(8);
    if (error) throw error; return data || [];
  } });
  if (contents.isLoading || summary.isLoading) return <AdminLoading label="正在准备工作台" />;
  const items = contents.data || [];
  const metrics = summary.data || { published: 0, draft: 0, hidden: 0, trashed: 0, storageBytes: 0 };
  return <div className="admin-page-stack"><AdminPageHeader context={`${profile.displayName} · ${roleText[profile.role]}`} title="内容工作台" description="集中处理草稿、发布状态和最近操作。" action={canEdit(profile.role) ? <Link className="button primary" to="/admin/contents/new"><Plus />新建资料</Link> : undefined} />
    <div className="metric-row"><Link to="/admin/contents?status=published"><span>已发布</span><strong>{metrics.published}</strong><small>前台可见内容</small></Link><Link to="/admin/contents?status=draft"><span>待处理草稿</span><strong>{metrics.draft}</strong><small>继续编辑与发布</small></Link><Link to="/admin/contents?status=hidden"><span>隐藏内容</span><strong>{metrics.hidden}</strong><small>仅后台可见</small></Link><Link to="/admin/contents"><span>媒体容量</span><strong>{formatBytes(metrics.storageBytes)}</strong><small>在每篇资料内管理图片、视频与附件</small></Link></div>
    <div className="admin-dashboard-grid"><section className="admin-panel"><div className="panel-heading"><div><h2>待处理内容</h2><p>草稿和隐藏资料</p></div><Link to="/admin/contents">查看全部<ChevronRight /></Link></div><CompactContentList items={items} /></section>
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
  const pageKey = ["admin-content-page", { status, category, query, sort, page }] as const;
  const contents = useQuery({ queryKey: pageKey, queryFn: () => loadAdminContentPage({ status, categoryId: category, query, sort: sort as "updated" | "title" | "order", page, pageSize }), staleTime: 30_000, placeholderData: (previous) => previous });
  const updateParam = (name: string, value: string) => { const next = new URLSearchParams(params); if (!value || value === "all" || (name === "sort" && value === "updated")) next.delete(name); else next.set(name, value); if (name !== "page") next.delete("page"); setParams(next); };
  const visible = contents.data?.items || [];
  const total = contents.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const refresh = () => { client.invalidateQueries({ queryKey: ["admin-content-page"] }); client.invalidateQueries({ queryKey: ["admin-content-list"] }); client.invalidateQueries({ queryKey: ["admin-dashboard-pending"] }); client.invalidateQueries({ queryKey: ["admin-dashboard-summary"] }); client.invalidateQueries({ queryKey: ["admin-category-counts"] }); setSelected(new Set()); };
  const notify = (value: string, error = false) => { setMessage(value); setMessageError(error); };
  const markPending = (ids: string[], value: boolean) => setPendingIds((current) => { const next = new Set(current); ids.forEach((id) => value ? next.add(id) : next.delete(id)); return next; });
  const runStatus = async (item: ContentItem, next: "draft" | "hidden" | "trashed") => {
    const previous = client.getQueryData<{ items: ContentItem[]; total: number }>(pageKey);
    client.setQueryData<{ items: ContentItem[]; total: number }>(pageKey, (current) => current ? { ...current, items: current.items.map((row) => row.id === item.id ? { ...row, status: next, version: row.version + 1 } : row) } : current);
    markPending([item.id], true);
    try { await changeContentStatus(item.id, item.version, next, profile.id); notify(next === "trashed" ? "已移入回收站。" : "状态已更新。"); refresh(); }
    catch (error) { client.setQueryData(pageKey, previous); notify(messageOf(error), true); }
    finally { markPending([item.id], false); }
  };
  const runPublish = async (item: ContentItem) => { try { await publishContent(item.id, item.version); notify("资料和媒体已发布。"); refresh(); } catch (error) { notify(messageOf(error, "发布失败"), true); } };
  const runDuplicate = async (item: ContentItem) => { try { const copy = await duplicateContent(item.id); notify("已复制为草稿。"); refresh(); navigate(`/admin/contents/${copy.id}`); } catch (error) { notify(messageOf(error, "复制失败"), true); } };
  const runDeleteForever = async (item: ContentItem) => {
    const previous = client.getQueryData<{ items: ContentItem[]; total: number }>(pageKey);
    client.setQueryData<{ items: ContentItem[]; total: number }>(pageKey, (current) => current ? { items: current.items.filter((row) => row.id !== item.id), total: Math.max(0, current.total - 1) } : current);
    markPending([item.id], true);
    try { const result = await deleteContentForever([{ id: item.id, version: item.version }]); if (result.succeeded !== 1) throw new Error(result.results[0]?.error || "删除失败"); notify("资料已删除，关联文件正在后台清理。"); refresh(); }
    catch (error) { client.setQueryData(pageKey, previous); notify(messageOf(error, "彻底删除失败"), true); }
    finally { markPending([item.id], false); }
  };
  const runBatch = async (action: "move" | "draft" | "hidden" | "trashed" | "published" | "delete_forever") => {
    const rows = visible.filter((item) => selected.has(item.id)); if (!rows.length) return;
    const previous = client.getQueryData<{ items: ContentItem[]; total: number }>(pageKey);
    markPending(rows.map((row) => row.id), true);
    if (action === "delete_forever") client.setQueryData<{ items: ContentItem[]; total: number }>(pageKey, (current) => current ? { items: current.items.filter((item) => !selected.has(item.id)), total: Math.max(0, current.total - rows.length) } : current);
    else if (["draft", "hidden", "trashed"].includes(action)) client.setQueryData<{ items: ContentItem[]; total: number }>(pageKey, (current) => current ? { ...current, items: current.items.map((item) => selected.has(item.id) ? { ...item, status: action as ContentStatus, version: item.version + 1 } : item) } : current);
    try {
      if (action === "published") { for (const row of rows) await publishContent(row.id, row.version); notify(`已发布 ${rows.length} 篇资料。`); }
      else if (action === "delete_forever") { const result = await deleteContentForever(rows.map(({ id, version }) => ({ id, version }))); notify(`已彻底删除 ${result.succeeded} 篇资料。`, result.succeeded !== rows.length || Boolean(result.storageWarnings?.length)); }
      else { const result = await batchContent(rows.map(({ id, version }) => ({ id, version })), action, action === "move" ? batchCategory : undefined); notify(`已处理 ${result.succeeded} 篇资料。`, result.succeeded !== rows.length); }
      refresh();
    } catch (error) { client.setQueryData(pageKey, previous); notify(messageOf(error, "批量操作失败"), true); }
    finally { markPending(rows.map((row) => row.id), false); }
  };
  if (contents.isLoading) return <AdminLoading label="正在读取内容" />;
  const selectedRows = visible.filter((item) => selected.has(item.id));
  const canDeleteForever = profile.role === "super_admin" && selectedRows.length > 0 && selectedRows.every((item) => item.status === "trashed");
  return <div className="admin-page-stack"><AdminToast message={message} error={messageError} onClose={() => setMessage("")} /><AdminPageHeader title="内容管理" description="搜索、筛选、批量处理和发布资料。" action={canEdit(profile.role) ? <Link className="button primary" to="/admin/contents/new"><Plus />新增资料</Link> : undefined} />
    <div className="status-tabs"><button className={status === "all" ? "active" : ""} onClick={() => updateParam("status", "all")}>全部 {status === "all" && <span>{total}</span>}</button>{(["published", "draft", "hidden", "trashed"] as ContentStatus[]).map((key) => <button className={status === key ? "active" : ""} key={key} onClick={() => updateParam("status", key)}>{statusText[key]} {status === key && <span>{total}</span>}</button>)}</div>
    <div className="admin-filterbar"><label className="search-control"><Search /><input value={query} onChange={(event) => updateParam("q", event.target.value)} placeholder="搜索标题、简介或分类" /></label><select value={category} onChange={(event) => updateParam("category", event.target.value)}><option value="all">全部分类</option>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={sort} onChange={(event) => updateParam("sort", event.target.value)}><option value="updated">最近更新</option><option value="title">标题排序</option><option value="order">自定义顺序</option></select></div>
    {selected.size > 0 && <div className="batch-toolbar"><strong>已选择 {selected.size} 项</strong><select value={batchCategory} onChange={(event) => setBatchCategory(event.target.value)}><option value="">移动到分类</option>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button disabled={!batchCategory} onClick={() => runBatch("move")}>移动</button>{canPublish(profile.role) && <><button onClick={() => runBatch("published")}><Check />发布</button><button onClick={() => runBatch("hidden")}><Eye />隐藏</button></>}{profile.role === "super_admin" && <button className="danger" onClick={() => window.confirm("确定将所选内容移入回收站吗？") && runBatch("trashed")}><Trash2 />回收</button>}{canDeleteForever && <button className="danger" onClick={() => window.confirm("确定永久删除所选回收站内容吗？此操作无法撤销。") && runBatch("delete_forever")}><Trash2 />彻底删除</button>}<button className="icon-only" onClick={() => setSelected(new Set())}><X /></button></div>}
    <section className="admin-panel flush"><div className="content-admin-table"><div className="content-table-head"><input type="checkbox" checked={visible.length > 0 && visible.every((item) => selected.has(item.id))} onChange={(event) => setSelected(event.target.checked ? new Set([...selected, ...visible.map((item) => item.id)]) : new Set([...selected].filter((id) => !visible.some((item) => item.id === id))))} /><span>资料</span><span>分类</span><span>状态</span><span>更新时间</span><span>操作</span></div>{visible.map((item) => <div className={`content-table-row${pendingIds.has(item.id) ? " pending" : ""}`} key={item.id}><input type="checkbox" disabled={pendingIds.has(item.id)} checked={selected.has(item.id)} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(item.id) : next.delete(item.id); setSelected(next); }} /><ContentThumb item={item} /><div className="content-row-title"><Link to={`/admin/contents/${item.id}`}>{item.title}</Link><span>{item.summary || "暂无简介"}{item.pendingMediaCount ? ` · ${item.pendingMediaCount} 个媒体待发布` : ""}</span></div><span>{item.categoryName}</span><StatusBadge status={item.status} /><time>{formatDate(item.updatedAt)}</time><div className="row-actions">{pendingIds.has(item.id) ? <LoaderCircle className="spin" /> : <>{canEditItem(profile, item) && item.status !== "trashed" && <Link title="编辑" to={`/admin/contents/${item.id}`}><FilePenLine /></Link>}{canEdit(profile.role) && item.status !== "trashed" && <button title="复制为草稿" onClick={() => runDuplicate(item)}><Copy /></button>}{canPublish(profile.role) && item.status !== "trashed" && <button title={item.pendingMediaCount ? "发布媒体更新" : "发布"} onClick={() => runPublish(item)}><Check /></button>}{item.status === "trashed" && canPublish(profile.role) && <button title="恢复草稿" onClick={() => runStatus(item, "draft")}><ArchiveRestore /></button>}{item.status === "trashed" && profile.role === "super_admin" && <button className="danger" title="彻底删除" onClick={() => window.confirm(`确定永久删除“${item.title}”吗？此操作无法撤销。`) && runDeleteForever(item)}><Trash2 /></button>}{profile.role === "super_admin" && item.status !== "trashed" && <button className="danger" title="移入回收站" onClick={() => window.confirm(`确定回收“${item.title}”吗？`) && runStatus(item, "trashed")}><Trash2 /></button>}</>}</div></div>)}{!visible.length && <AdminEmpty title="没有符合条件的资料" detail="调整筛选条件或新建一篇资料。" />}</div></section>
    <div className="pagination"><span>共 {total} 条</span><button disabled={page <= 1} onClick={() => updateParam("page", String(page - 1))}><ChevronLeft /></button><strong>{Math.min(page, pages)} / {pages}</strong><button disabled={page >= pages} onClick={() => updateParam("page", String(page + 1))}><ChevronRight /></button></div>
  </div>;
}

export function NewContentPage({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  const categories = useAdminCategories();
  const [title, setTitle] = useState(""); const [categoryId, setCategoryId] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!categoryId && categories.data?.[0]) setCategoryId(categories.data[0].id); }, [categoryId, categories.data]);
  const create = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { const data = await saveContent({ slug: slugify(title), categoryId, title: title.trim(), summary: "", bodyHtml: "<p></p>", bodyJson: {}, bodyText: "", sourceRecord: "", status: "draft", featured: false, sortOrder: 100, tags: [] }, profile.id); navigate(`/admin/contents/${data.id}`, { replace: true }); } catch (error) { setMessage(messageOf(error, "草稿创建失败")); setSaving(false); } };
  return <div className="quick-create-page"><Link className="back-link" to="/admin/contents"><ArrowLeft />返回内容管理</Link><form className="quick-create" onSubmit={create}><h1>创建资料草稿</h1><p>先建立标题和分类，下一步即可编辑正文并上传媒体。</p><label>资料标题<input required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入清晰、容易搜索的标题" /></label><label>所属分类<select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{message && <div className="form-message">{message}</div>}<button className="button primary" disabled={saving || !title.trim() || !categoryId}>{saving ? <LoaderCircle className="spin" /> : <Plus />}{saving ? "正在创建..." : "创建并进入编辑器"}</button></form></div>;
}

export function ContentEditorPage({ profile }: { profile: Profile }) {
  const { id = "" } = useParams(); const navigate = useNavigate(); const client = useQueryClient();
  const content = useQuery({ queryKey: ["admin-content", id], queryFn: () => loadAdminContent(id), enabled: Boolean(id) });
  const categories = useAdminCategories();
  const [draft, setDraft] = useState<ContentDraft | null>(null); const [dirty, setDirty] = useState(false); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [messageError, setMessageError] = useState(false); const [tab, setTab] = useState<"body" | "media" | "preview">("body"); const [importUrl, setImportUrl] = useState(""); const [importing, setImporting] = useState(false); const [importProgress, setImportProgress] = useState(0); const [pendingImport, setPendingImport] = useState<{ preview: ImportPreview; file?: File } | null>(null); const [selectedSheets, setSelectedSheets] = useState<string[]>([]); const [importMode, setImportMode] = useState<"append" | "replace">("append"); const [importBackup, setImportBackup] = useState<ContentDraft | null>(null); const [recovery, setRecovery] = useState<ContentDraft | null>(null); const [importStage, setImportStage] = useState<EditorImportStage>("idle"); const [importJobId, setImportJobId] = useState(""); const [importFailure, setImportFailure] = useState(""); const [registeredImages, setRegisteredImages] = useState(0); const [currentImage, setCurrentImage] = useState(0); const [importRetries, setImportRetries] = useState(0); const [importComplete, setImportComplete] = useState<{ imageCount: number; jobId: string } | null>(null); const [editorSafeMode, setEditorSafeMode] = useState(false); const loadedVersion = useRef<number | null>(null); const draftRef = useRef<ContentDraft | null>(null); const activeDocumentImport = useRef<{ id: string; assets: DocumentImportAsset[] } | null>(null); const importStageRef = useRef<EditorImportStage>("idle"); const registeredImagesRef = useRef(0); const currentImageRef = useRef(0); const importRetriesRef = useRef(0); const importProgressRenderRef = useRef(0); const editorRef = useRef<RichEditorHandle | null>(null);
  const embeddedMediaIds = useMemo(() => [...referencedMediaIds(draft?.bodyHtml || "")], [draft?.bodyHtml]);
  const embeddedMedia = useQuery({ queryKey: ["admin-embedded-media", id, embeddedMediaIds.join(",")], queryFn: () => loadAdminEmbeddedMedia(id, embeddedMediaIds), enabled: Boolean(id && tab !== "media" && embeddedMediaIds.length), staleTime: 30_000 });
  const changeImportStage = (stage: EditorImportStage) => { importStageRef.current = stage; setImportStage(stage); };
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    if (!id || !content.data) return;
    void cleanupDocumentImportMedia(id).then((result) => {
      if (result.removed > 0) notify(`已清理上一批 Word 导入的 ${result.removed} 个旧文件。`);
      if (result.failed > 0) void reportRuntimeLog({ source: "storage-cleanup", message: "部分旧导入文件等待下次重试", severity: "warning", context: { contentId: id, failed: result.failed } });
    }).catch((error) => void reportRuntimeLog({ source: "storage-cleanup", message: messageOf(error, "旧导入文件清理失败"), error, context: { contentId: id } }));
  }, [content.data?.id, id]);
  useEffect(() => {
    if (!content.data || loadedVersion.current === content.data.version) return;
    const item = content.data;
    loadedVersion.current = item.version;
    const initial: ContentDraft = { id: item.id, slug: item.slug, categoryId: item.categoryId, title: item.title, summary: item.summary, bodyHtml: item.bodyHtml, bodyJson: item.bodyJson, bodyText: item.bodyText, sourceRecord: item.sourceRecord, status: item.status, featured: item.featured, sortOrder: item.sortOrder, version: item.version, tags: item.tags };
    draftRef.current = initial;
    setDraft(initial);
    setDirty(false);
    setRecovery(null);
    let active = true;
    void readEditorRecovery(id).then((saved) => {
      if (active && saved?.version === item.version) setRecovery(saved.draft);
    });
    return () => { active = false; };
  }, [content.data, id]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const update = (patch: Partial<ContentDraft>) => { setDraft((current) => { const next = current ? { ...current, ...patch } : current; draftRef.current = next; return next; }); setDirty(true); };
  const saveRecoverySnapshot = (snapshot: RichEditorSnapshot) => {
    const current = draftRef.current;
    if (current) void saveEditorRecovery(id, current, snapshot);
  };
  const clearRecovery = () => { void clearEditorRecovery(id); setRecovery(null); };
  const notify = (value: string, error = false) => { setMessage(value); setMessageError(error); };
  const importErrorMessage = (error: unknown) => {
    if (!(error instanceof DocumentImportError)) return messageOf(error, "导入或原文件上传失败");
    const stageText: Record<DocumentImportStage, string> = { start: "创建导入任务", list: "读取导入任务", register: "登记已上传图片", status: "读取导入状态", retry: "恢复导入任务", event: "记录导入事件", finalize: "核验并提交图片", fail: "清理导入文件", cancel: "取消导入", cleanup: "清理旧导入文件" };
    const status = error.status ? `（HTTP ${error.status}）` : "";
    if (error.code === "IMPORT_MANIFEST_INCOMPLETE") {
      const invalid = Array.isArray(error.details.invalid_asset_indexes) ? error.details.invalid_asset_indexes.join("、") : "";
      const duplicate = error.details.duplicate_media_ids ? "图片媒体编号重复" : "";
      const diagnostic = [invalid ? `无效图片序号：${invalid}` : "", duplicate].filter(Boolean).join("；");
      return `${stageText[error.stage]}失败${status}：${error.message}${diagnostic ? `（${diagnostic}）` : ""}`;
    }
    const retryCount = Number(error.details.retry_count || 0);
    const retryHint = retryCount > 0 ? `（已自动重试 ${retryCount} 次；服务恢复后可继续导入，已登记图片不会重复上传）` : "";
    return `${stageText[error.stage]}失败${status}：${error.message}${retryHint}`;
  };
  const draftWithEditorState = () => {
    if (!draft) return null;
    const snapshot = editorRef.current?.serialize();
    return snapshot ? { ...draft, bodyHtml: snapshot.html, bodyText: snapshot.text, bodyJson: snapshot.json } : draft;
  };
  const invalidateContentLists = () => {
    client.invalidateQueries({ queryKey: ["admin-content-list"] });
    client.invalidateQueries({ queryKey: ["admin-content-page"] });
    client.invalidateQueries({ queryKey: ["admin-dashboard-pending"] });
    client.invalidateQueries({ queryKey: ["admin-dashboard-summary"] });
    client.invalidateQueries({ queryKey: ["admin-category-counts"] });
  };
  const save = async (override?: ContentDraft) => { const currentDraft = override || draftWithEditorState(); if (!currentDraft) return null; setSaving(true); try { const result = await saveContent(currentDraft, profile.id); loadedVersion.current = result.version; const next = { ...currentDraft, version: result.version }; draftRef.current = next; setDraft(next); setDirty(false); clearRecovery(); notify(result.tagWarning || "草稿已保存到云端。", Boolean(result.tagWarning)); invalidateContentLists(); return result; } catch (error) { notify(error instanceof Error && error.message === "VERSION_CONFLICT" ? "资料已被其他管理员修改，请重新载入后再编辑。" : messageOf(error, "保存失败"), true); return null; } finally { setSaving(false); } };
  const publish = async () => { const currentDraft = draftWithEditorState(); if (!currentDraft || !content.data) return; if (!currentDraft.title.trim() || !currentDraft.summary.trim() || !currentDraft.categoryId || (!currentDraft.bodyText.trim() && !(content.data.mediaCount || content.data.attachmentCount))) return notify("发布前请补齐标题、简介、分类以及正文或媒体。", true); const saved = dirty ? await save(currentDraft) : { version: currentDraft.version }; if (!saved?.version) return; setSaving(true); try { await publishContent(id, saved.version); clearRecovery(); notify("资料和媒体更新已发布。"); client.invalidateQueries({ queryKey: ["public-home"] }); client.invalidateQueries({ queryKey: ["public-category"] }); client.invalidateQueries({ queryKey: ["public-content"] }); invalidateContentLists(); await content.refetch(); } catch (error) { notify(messageOf(error, "发布失败"), true); } finally { setSaving(false); } };
  const openPreview = () => {
    const current = draftWithEditorState();
    if (current) { draftRef.current = current; setDraft(current); }
    setTab("preview");
  };
  const goBack = () => { if (!dirty || window.confirm("存在未保存修改，确定离开编辑器吗？")) navigate("/admin/contents"); };
  const stageImport = (preview: ImportPreview, file?: File) => { setPendingImport({ preview, file }); setSelectedSheets(preview.worksheets?.[0] ? [preview.worksheets[0].name] : []); setImportMode(draft?.bodyText.trim() ? "append" : "replace"); notify(`已读取“${preview.title}”，确认后才会写入正文。`); };
  const importFile = async (file: File) => { setImporting(true); try { const { readDocument } = await import("../../lib/documents"); stageImport(await readDocument(file), file); } catch (error) { void reportRuntimeLog({ source: "document-import", message: messageOf(error, "文档读取失败"), error, context: { fileName: file.name, fileType: file.type, fileSize: file.size } }); notify(messageOf(error, "文档读取失败"), true); } finally { setImporting(false); } };
  const importPage = async () => { if (!importUrl.trim()) return; setImporting(true); try { const { readWebPage } = await import("../../lib/documents"); stageImport(await readWebPage(importUrl.trim())); } catch (error) { void reportRuntimeLog({ source: "web-import", message: messageOf(error, "网页读取失败"), error, context: { host: (() => { try { return new URL(importUrl).host; } catch { return "invalid"; } })() } }); notify(`${messageOf(error, "网页读取失败")}。腾讯文档请下载 Word 后导入。`, true); } finally { setImporting(false); } };
  const preserveOriginal = async (file: File) => {
    if (file.size > 100 * 1024 * 1024) return false;
    const path = cosStorageEnabled
      ? `drafts/${id}/attachments/${randomId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
      : `${profile.id}/${id}/source-${randomId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const stored = await uploadManagedFile({ file, path, purpose: "content-media", contentId: id, visibility: "private", onProgress: (value) => setImportProgress(value.percent) });
    const { error } = await supabase.from("attachments").insert({ content_id: id, storage_provider: stored.provider, storage_bucket: stored.bucket, storage_path: stored.path, name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, sort_order: (content.data?.attachmentCount || 0) * 10 + 10, created_by: profile.id });
    if (error) { await removeStoredObjects({ provider: stored.provider, bucket: stored.bucket, paths: [stored.path], contentId: id }); throw error; }
    return true;
  };
  const confirmImport = async () => {
    if (!pendingImport || !draft) return;
    const importSnapshot = pendingImport;
    const sourceFile = importSnapshot.file;
    const wordImages = importSnapshot.preview.wordImages;
    const imported = importSnapshot.preview.worksheets ? composeImportPreview(importSnapshot.preview.worksheets, selectedSheets) : importSnapshot.preview;
    if (!imported.bodyHtml.trim()) return notify("请至少选择一个有内容的工作表。", true);
    setImporting(true); changeImportStage("start"); setImportJobId(""); setImportFailure("");
    let wordJob: { id: string; uploadPrefix: string; storageProvider?: "supabase" | "tencent_cos" } | null = null;
    const documentResumeKey = `maplestorynk-document-import-${id}`;
    try {
      let importedBody = imported;
      if (sourceFile?.name.toLowerCase().endsWith(".docx") && wordImages?.count) {
        if (!draft.version) throw new Error("资料版本缺失，请重新打开编辑器后导入");
        let savedResume = (() => {
          try { return JSON.parse(sessionStorage.getItem(documentResumeKey) || "null") as { id?: string; fileName?: string; fileSize?: number; expectedImages?: number; uploadPrefix?: string; version?: number } | null; } catch { return null; }
        })();
        if (!savedResume?.id) {
          const { jobs } = await listDocumentImports();
          const candidate = jobs.find((job) => job.content_id === id
            && job.source_file_name === sourceFile.name
            && Number(job.source_file_size) === sourceFile.size
            && Number(job.expected_images) === wordImages.count
            && (job.status === "uploading" || job.status === "failed"));
          if (candidate) {
            savedResume = { id: candidate.id, fileName: sourceFile.name, fileSize: sourceFile.size, expectedImages: wordImages.count, uploadPrefix: `imports/${candidate.id}`, version: draft.version };
            sessionStorage.setItem(documentResumeKey, JSON.stringify(savedResume));
          }
        }
        if (savedResume?.id && savedResume.fileName === sourceFile.name && savedResume.fileSize === sourceFile.size && savedResume.expectedImages === wordImages.count && savedResume.version === draft.version) {
          const resumeStatus = await getDocumentImportStatus(savedResume.id);
          const retryingCommit = resumeStatus.job.status === "failed" && resumeStatus.assets.length === wordImages.count;
          if (retryingCommit) await retryDocumentImport(savedResume.id);
          if (resumeStatus.job.status === "uploading" || retryingCommit) {
            wordJob = { id: savedResume.id, uploadPrefix: savedResume.uploadPrefix || `imports/${savedResume.id}`, storageProvider: resumeStatus.job.storageProvider };
            registeredImagesRef.current = resumeStatus.assets.length; setRegisteredImages(resumeStatus.assets.length);
            notify(`${retryingCommit ? "正在重试数据库提交" : "继续导入任务"}：已安全登记 ${resumeStatus.assets.length}/${wordImages.count} 张图片，无需重新上传。`);
          } else {
            sessionStorage.removeItem(documentResumeKey);
          }
        }
        if (!wordJob) {
          wordJob = await startDocumentImport({ contentId: id, expectedVersion: draft.version, expectedImages: wordImages.count, totalOriginalBytes: wordImages.totalOriginalBytes, sourceFileName: sourceFile.name, sourceFileSize: sourceFile.size, storageProvider: cosStorageEnabled ? "tencent_cos" : "supabase" });
          sessionStorage.setItem(documentResumeKey, JSON.stringify({ ...wordJob, fileName: sourceFile.name, fileSize: sourceFile.size, expectedImages: wordImages.count, version: draft.version }));
          registeredImagesRef.current = 0; currentImageRef.current = 0; importRetriesRef.current = 0; setRegisteredImages(0); setCurrentImage(0); setImportRetries(0);
        }
        setImportJobId(wordJob.id);
        activeDocumentImport.current = { id: wordJob.id, assets: [] };
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("登录已过期，请重新登录后再导入。");
        const uploadSession: WordUploadSession = {
          supabaseUrl,
          publishableKey: supabasePublishableKey,
          accessToken,
          bucket: publicMediaBucket,
          importId: wordJob.id,
          uploadPrefix: wordJob.uploadPrefix,
          existingMediaCount: content.data?.mediaCount || 0,
          expectedImages: wordImages.count,
          storageProvider: wordJob.storageProvider || (cosStorageEnabled ? "tencent_cos" : "supabase"),
          mediaBaseUrl
        };
        const { materializeWordDocument } = await import("../../lib/documents");
        const materializedWord = await materializeWordDocument(sourceFile, uploadSession, (progress: WordImportProgress) => {
          const now = performance.now();
          const milestone = ["fallback", "parsed", "resumed", "retry", "registered", "uploaded"].includes(progress.phase);
          if (!milestone && now - importProgressRenderRef.current < 250) return;
          importProgressRenderRef.current = now;
          currentImageRef.current = progress.imageIndex; setCurrentImage(progress.imageIndex);
          importRetriesRef.current = progress.retries || 0; setImportRetries(progress.retries || 0);
          if (progress.phase === "registered") { registeredImagesRef.current = progress.imageIndex; setRegisteredImages(progress.imageIndex); }
          const completed = progress.phase === "registered" || progress.phase === "resumed";
          const ratio = progress.total ? (progress.loaded || 0) / progress.total : completed ? 1 : 0;
          setImportProgress(Math.round(((progress.imageIndex - 1 + ratio) / wordImages.count) * 100));
          changeImportStage(progress.phase === "registered" || progress.phase === "retry" ? "register" : "upload-original");
          notify(progress.phase === "fallback"
            ? "Worker 图片通道不可用，已自动切换兼容导入模式。"
            : `Word 图片 ${progress.imageIndex}/${wordImages.count} · ${progress.detail || (progress.phase === "registered" ? "已登记" : progress.phase === "resumed" ? "已恢复" : progress.phase === "retry" ? "正在重试" : "正在上传")}`);
          if (["fallback", "parsed", "resumed", "registered", "uploaded"].includes(progress.phase)) {
            void logDocumentImportEvent(wordJob!.id, {
              phase: progress.phase, imageIndex: progress.imageIndex, bytesTotal: progress.total, bytesUploaded: progress.loaded,
              retryCount: progress.retries, message: progress.detail || `图片 ${progress.imageIndex} ${progress.phase}`
            });
          }
        });
        importedBody = materializedWord;
        if (materializedWord.imageCount !== wordImages.count || materializedWord.uploadedImageCount !== wordImages.count) {
          throw new Error(`Word 图片处理未完成：识别 ${wordImages.count} 张，正文生成 ${materializedWord.imageCount} 张，已上传 ${materializedWord.uploadedImageCount} 张。`);
        }
      }
      setImportBackup(draft);
      const bodyHtml = sanitizeHtml(importMode === "append" && draft.bodyText.trim() ? `${draft.bodyHtml}<hr>${importedBody.bodyHtml}` : importedBody.bodyHtml);
      const bodyText = new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent || importedBody.bodyText;
      const sourceRecord = [draft.sourceRecord, importSnapshot.preview.source].filter(Boolean).join("\n");
      if (wordJob && activeDocumentImport.current) {
        changeImportStage("verify");
        changeImportStage("finalize");
        const finalized = await finalizeDocumentImport({ importId: wordJob.id, expectedVersion: draft.version || 1, bodyHtml, sourceRecord });
        const nextDraft = { ...draft, title: draft.title || importSnapshot.preview.title, bodyHtml, bodyText, bodyJson: {}, sourceRecord, version: finalized.version };
        loadedVersion.current = finalized.version;
        draftRef.current = nextDraft; setDraft(nextDraft); setDirty(false); clearRecovery();
        activeDocumentImport.current = null;
        sessionStorage.removeItem(documentResumeKey);
        if (sourceFile && sourceFile.size <= 100 * 1024 * 1024) {
          try { await preserveOriginal(sourceFile); } catch (attachmentError) { void reportRuntimeLog({ source: "document-import-attachment", message: messageOf(attachmentError, "原始 Word 附件保存失败"), error: attachmentError, context: { fileName: sourceFile.name, fileSize: sourceFile.size } }); }
        }
        await content.refetch();
        invalidateContentLists();
        client.invalidateQueries({ queryKey: ["admin-media", id] });
        changeImportStage("complete");
        setImportComplete({ imageCount: finalized.imported_images, jobId: wordJob.id });
        setEditorSafeMode(false);
        setTab("body");
        notify(`已安全保存正文和 ${finalized.imported_images}/${wordImages?.count || 0} 张原始图片。`);
      } else {
        update({ title: draft.title || importSnapshot.preview.title, bodyHtml, bodyText, bodyJson: {}, sourceRecord });
        notify(importSnapshot.preview.warning || `已导入“${importSnapshot.preview.title}”，保存草稿后正式生效。`);
      }
      setPendingImport(null); setImportUrl("");
    } catch (error) {
      const failureMessage = importErrorMessage(error);
      const uploadedImages = registeredImagesRef.current;
      if (wordJob) void logDocumentImportEvent(wordJob.id, {
        phase: "failed", severity: "error", imageIndex: currentImageRef.current || undefined, retryCount: importRetriesRef.current,
        message: failureMessage, errorCode: error instanceof DocumentImportError ? error.code : "CLIENT_IMPORT_FAILED"
      });
      const details = error instanceof DocumentImportError ? error.details : {};
      setImportFailure(failureMessage);
      void reportRuntimeLog({ source: "document-import", message: failureMessage, error, context: { contentId: id, fileName: sourceFile?.name, imageCount: wordImages?.count, importJobId: error instanceof DocumentImportError ? String(details.import_id || importJobId) : importJobId, importStage: error instanceof DocumentImportError ? error.stage : importStageRef.current, httpStatus: error instanceof DocumentImportError ? error.status : null, errorCode: error instanceof DocumentImportError ? error.code : null, databaseError: typeof details.database_error === "string" ? details.database_error.slice(0, 1500) : "", missingCount: Number(details.missing_count || 0), invalidAssetIndexes: Array.isArray(details.invalid_asset_indexes) ? details.invalid_asset_indexes.join(",") : "", manifestDiagnostics: Array.isArray(details.invalid_assets) ? JSON.stringify(details.invalid_assets).slice(0, 500) : "", uploadedImages } });
      notify(failureMessage, true);
    }
    finally { setImporting(false); setImportProgress(0); }
  };
  const discardPendingImport = () => {
    const active = activeDocumentImport.current;
    if (active && !importing) {
      void cancelDocumentImport(active.id, active.assets, "管理员取消导入任务");
      activeDocumentImport.current = null;
      sessionStorage.removeItem(`maplestorynk-document-import-${id}`);
    }
    setPendingImport(null); changeImportStage("idle"); setImportJobId(""); setImportFailure("");
  };
  const uploadInlineImages = async (files: File[]) => {
    const uploaded: Array<{ src: string; alt: string; caption?: string }> = [];
    try {
      for (const [index, file] of files.entries()) {
        if (!file.type.startsWith("image/")) throw new Error("正文中只能直接插入图片文件。");
        validateUpload(file);
        const path = cosStorageEnabled
          ? `content/${id}/inline/${randomId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
          : `inline/${id}/${randomId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const stored = await uploadManagedFile({
          file, path, purpose: "content-media", contentId: id, visibility: "public",
          onProgress: (value) => setImportProgress(Math.round(((index + value.loaded / value.total) / files.length) * 100))
        });
        const name = file.name.replace(/\.[^.]+$/, "");
        uploaded.push({ src: stored.provider === "tencent_cos" ? `${mediaBaseUrl}/${stored.path.split("/").map(encodeURIComponent).join("/")}` : publicAssetUrl(stored.path), alt: name });
      }
      notify(`已上传并插入 ${uploaded.length} 张图片。`);
      return uploaded;
    } finally {
      setImportProgress(0);
    }
  };
  const uploadInlineMedia = async (file: File): Promise<RichEditorMedia> => {
    const type = validateUpload(file);
    if (!type.image && !type.video) throw new Error("正文只能插入图片或视频。");
    const preparedVideo = type.video ? await prepareBrowserVideo(file, (value) => {
      setImportProgress(Math.round(value.percent * 0.6));
    }) : null;
    const prepared = type.image ? await imageToWebp(file) : preparedVideo?.video || file;
    const path = cosStorageEnabled
      ? `drafts/${id}/media/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
      : `${profile.id}/${id}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const stored = await uploadManagedFile({
      file: prepared,
      path,
      purpose: "content-media",
      contentId: id,
      visibility: "private",
      onProgress: (value) => setImportProgress(preparedVideo ? 60 + Math.round(value.percent * 0.3) : value.percent)
    });
    let storedPoster: Awaited<ReturnType<typeof uploadManagedFile>> | null = null;
    try {
      if (preparedVideo) {
        storedPoster = await uploadManagedFile({
          file: preparedVideo.poster,
          path: videoPosterPath(path),
          purpose: "content-media",
          contentId: id,
          visibility: "private",
          onProgress: (value) => setImportProgress(90 + Math.round(value.percent * 0.1))
        });
      }
      const count = await supabase.from("content_media").select("id", { count: "exact", head: true }).eq("content_id", id);
      if (count.error) throw count.error;
      const dimensions = type.image ? await imageDimensions(prepared) : preparedVideo ? { width: preparedVideo.width, height: preparedVideo.height } : {};
      const title = file.name.replace(/\.[^.]+$/, "");
      const result = await supabase.from("content_media").insert({
        content_id: id,
        kind: type.video ? "video" : "image",
        storage_provider: stored.provider,
        storage_bucket: stored.bucket,
        storage_path: stored.path,
        title,
        alt_text: file.name,
        mime_type: type.video ? normalizedVideoMimeType(prepared) || prepared.type || "video/mp4" : prepared.type,
        size_bytes: prepared.size,
        sort_order: (count.count || 0) * 10 + 10,
        created_by: profile.id,
        processing_status: "ready",
        video_codec: preparedVideo?.codec || null,
        duration_ms: preparedVideo?.durationMs || null,
        poster_storage_path: storedPoster?.path || null,
        placement_status: "inserted",
        ...dimensions
      }).select("*").single();
      if (result.error || !result.data) throw result.error || new Error("媒体登记失败");
      let previewUrl = "";
      let posterPreviewUrl = "";
      if (stored.provider === "tencent_cos") {
        const signed = await invokeEdgeFunction<{ url?: string }>("cos-storage", { action: "signed-url", bucket: stored.bucket, path: stored.path, contentId: id }, "inline-media-preview");
        previewUrl = String(signed.url || "");
        if (storedPoster) {
          const signedPoster = await invokeEdgeFunction<{ url?: string }>("cos-storage", { action: "signed-url", bucket: storedPoster.bucket, path: storedPoster.path, contentId: id }, "inline-media-poster-preview");
          posterPreviewUrl = String(signedPoster.url || "");
        }
      } else {
        previewUrl = (await supabase.storage.from(stored.bucket).createSignedUrl(stored.path, 3600)).data?.signedUrl || "";
        if (storedPoster) posterPreviewUrl = (await supabase.storage.from(storedPoster.bucket).createSignedUrl(storedPoster.path, 3600)).data?.signedUrl || "";
      }
      notify(preparedVideo?.converted ? "视频已在本机转换为 H.264/AAC，并上传到正文当前位置。" : "媒体已上传并插入正文。");
      void content.refetch();
      return mediaRowToEditorMedia({ ...result.data, previewUrl, posterPreviewUrl } as MediaRow);
    } catch (error) {
      await removeStoredObjects({ provider: stored.provider, bucket: stored.bucket, paths: [stored.path, storedPoster?.path].filter(Boolean).map(String), contentId: id });
      throw error;
    } finally {
      setImportProgress(0);
    }
  };
  if (content.error) return <div className="admin-error"><Database /><h1>资料读取失败</h1><p>{messageOf(content.error)}</p><button className="button" onClick={() => content.refetch()}><RefreshCcw />重新读取</button></div>;
  if (content.isLoading || !draft || !content.data) return <AdminLoading label="正在打开编辑工作区" />;
  if (!canEditItem(profile, content.data)) return <div className="admin-error"><Eye /><h1>仅可查看</h1><p>上传管理员只能编辑自己创建的草稿。</p><button className="button" onClick={() => navigate("/admin/contents")}>返回内容管理</button></div>;
  return <div className="content-workspace"><AdminToast message={message} error={messageError} onClose={() => setMessage("")} /><header className="workspace-header"><button className="icon-only" type="button" onClick={goBack}><ArrowLeft /></button><div className="workspace-title"><span><StatusBadge status={content.data.status} /> 版本 {draft.version}{dirty && " · 有未保存修改"}{Boolean(content.data.pendingMediaCount) && ` · ${content.data.pendingMediaCount} 个媒体待发布`}</span><h1>{draft.title || "未命名资料"}</h1></div><div className="workspace-actions"><button className="button quiet" type="button" onClick={() => tab === "preview" ? setTab("body") : openPreview()}><Eye />{tab === "preview" ? "返回编辑" : "预览"}</button><button className="button" disabled={saving || !dirty} type="button" onClick={() => { void save(); }}><Save />保存草稿</button>{canPublish(profile.role) && <button className="button primary" disabled={saving} type="button" onClick={publish}><Check />{content.data.pendingMediaCount ? "发布媒体更新" : "发布"}</button>}</div></header>
    {recovery && <div className="recovery-banner"><div><strong>发现未提交的本地修改</strong><span>可恢复上次关闭前的编辑内容。</span></div><button onClick={() => { draftRef.current = recovery; setDraft(recovery); setDirty(true); setRecovery(null); }}>恢复</button><button onClick={clearRecovery}>忽略</button></div>}
    {Boolean(content.data.pendingMediaCount) && <div className="media-publish-banner"><div><strong>{content.data.pendingMediaCount} 个媒体已上传，正在等待发布</strong><span>只有插入正文的图片和视频会在公开页面的对应位置显示。</span></div><button className="button primary" type="button" disabled={saving} onClick={publish}><Check />发布媒体更新</button></div>}
    <div className="workspace-tabs"><button className={tab === "body" ? "active" : ""} onClick={() => setTab("body")}><FileText />正文</button><button className={tab === "media" ? "active" : ""} onClick={() => setTab("media")}><FileImage />媒体与附件 <span>{(content.data.mediaCount || 0) + (content.data.attachmentCount || 0)}</span></button><button className={tab === "preview" ? "active" : ""} onClick={openPreview}><Eye />阅读预览</button></div>
    <div className="workspace-body"><main className="workspace-main"><div hidden={tab !== "body"}><section className="import-strip"><label><FileText /><span>导入 Word / Excel / TXT / Markdown</span><input type="file" accept=".docx,.xlsx,.xls,.txt,.md,.html" disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ""; }} /></label><div><Link2 /><input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="粘贴网页链接" /><button disabled={importing} type="button" onClick={importPage}>{importing ? "读取中" : "读取"}</button></div></section>{pendingImport && <ImportConfirmation preview={pendingImport.preview} selectedSheets={selectedSheets} onSelectedSheets={setSelectedSheets} mode={importMode} onMode={setImportMode} progress={importProgress} busy={importing} stage={importStage} jobId={importJobId} failure={importFailure} registeredImages={registeredImages} currentImage={currentImage} retries={importRetries} onConfirm={confirmImport} onCancel={discardPendingImport} />}{importBackup && <div className="import-undo-banner"><span>已将导入内容放入编辑器，尚未保存到云端。</span><button type="button" onClick={() => { setDraft(importBackup); setDirty(true); setImportBackup(null); notify("已恢复导入前正文。"); }}>撤销本次导入</button><button type="button" className="icon-only" aria-label="关闭撤销提示" onClick={() => setImportBackup(null)}><X /></button></div>}{importComplete ? <section className="import-complete-summary"><Check /><h2>文档与 {importComplete.imageCount} 张原图已安全保存</h2><p>为避免一次加载全部原图，专业编辑器暂未打开。可以先阅读预览，或在需要修改时继续编辑。</p><small>导入任务：{importComplete.jobId}</small><div><button className="button primary" type="button" onClick={openPreview}><Eye />阅读预览</button><button className="button quiet" type="button" onClick={() => setImportComplete(null)}><FilePenLine />继续编辑</button></div></section> : editorSafeMode ? <section className="editor-safe-mode"><h2>编辑器安全模式</h2><p>正文以只读方式显示，保存的数据没有丢失。</p><button className="button" type="button" onClick={() => setEditorSafeMode(false)}>重新打开编辑器</button><RichContent html={draft.bodyHtml} media={embeddedMedia.data || []} /></section> : <AppErrorBoundary scope="rich-editor" resetKey={`${id}:${draft.version}:${editorSafeMode}`} onSafeMode={() => setEditorSafeMode(true)}><Suspense fallback={<AdminLoading label="正在加载专业编辑器" />}><RichEditor ref={editorRef} value={draft.bodyHtml} media={embeddedMedia.data || []} onDirty={() => setDirty(true)} onSnapshot={saveRecoverySnapshot} onSafeMode={() => setEditorSafeMode(true)} onUploadImages={uploadInlineImages} onUploadMedia={uploadInlineMedia} /></Suspense></AppErrorBoundary>}</div>
      {tab === "media" && <ContentMediaManager contentId={id} profile={profile} autoPublish={content.data.status === "published" && canPublish(profile.role)} publishVersion={draft.version} onInsert={(media) => { setImportComplete(null); setTab("body"); window.requestAnimationFrame(() => { editorRef.current?.insertMedia(media); setDirty(true); notify(`“${media.title}”已插入正文。请保存或发布。`); }); }} onRemoveFromBody={async (mediaId) => { editorRef.current?.removeMedia(mediaId); const snapshot = editorRef.current?.serialize(); const current = draftRef.current; if (!current) throw new Error("正文尚未加载，媒体没有删除"); const nextHtml = snapshot?.html || removeMediaFigureHtml(current.bodyHtml, mediaId); const nextText = snapshot?.text || new DOMParser().parseFromString(nextHtml, "text/html").body.textContent || ""; const saved = await save({ ...current, bodyHtml: nextHtml, bodyText: nextText, bodyJson: snapshot?.json || {} }); if (!saved) throw new Error("正文位置保存失败，媒体尚未删除"); }} onReplaceInBody={(media) => editorRef.current?.replaceMedia(media)} onChanged={async () => { await content.refetch(); client.invalidateQueries({ queryKey: ["admin-embedded-media", id] }); invalidateContentLists(); }} />}
      {tab === "preview" && <DraftPreview draft={draft} item={content.data} media={embeddedMedia.data || []} />}</main>
      <aside className="workspace-inspector"><div className="inspector-heading"><h2>资料属性</h2></div><label>标题<input value={draft.title} onChange={(event) => update({ title: event.target.value })} /></label><label>简介<textarea value={draft.summary} onChange={(event) => update({ summary: event.target.value })} placeholder="用于列表和搜索结果" /></label><label>分类<select value={draft.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>{categories.data?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><div className="inspector-grid"><label>排序<input type="number" value={draft.sortOrder} onChange={(event) => update({ sortOrder: Number(event.target.value) })} /></label><label>路径<input value={draft.slug} onChange={(event) => update({ slug: slugify(event.target.value) })} /></label></div><label>标签<input value={draft.tags.join(", ")} onChange={(event) => update({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20) })} placeholder="BOSS图, 城镇图" /></label><label>来源记录<textarea value={draft.sourceRecord} onChange={(event) => update({ sourceRecord: event.target.value })} placeholder="仅后台可见" /></label>{canPublish(profile.role) && <label className="checkbox"><input type="checkbox" checked={draft.featured} onChange={(event) => update({ featured: event.target.checked })} />首页精选</label>}</aside></div>
  </div>;
}

function ImportConfirmation({ preview, selectedSheets, onSelectedSheets, mode, onMode, progress, busy, stage, jobId, failure, registeredImages, currentImage, retries, onConfirm, onCancel }: { preview: ImportPreview; selectedSheets: string[]; onSelectedSheets(value: string[]): void; mode: "append" | "replace"; onMode(value: "append" | "replace"): void; progress: number; busy: boolean; stage: DocumentImportStage | "upload-original" | "verify" | "complete" | "idle"; jobId: string; failure: string; registeredImages: number; currentImage: number; retries: number; onConfirm(): void; onCancel(): void }) {
  const composed = preview.worksheets ? composeImportPreview(preview.worksheets, selectedSheets) : preview;
  const toggleSheet = (name: string, checked: boolean) => onSelectedSheets(checked ? [...selectedSheets, name] : selectedSheets.filter((item) => item !== name));
  const steps: Array<[typeof stage, string]> = [["start", "创建任务"], ["upload-original", "上传原始图片"], ["register", "登记图片"], ["verify", "核验图片"], ["finalize", "提交正文"]];
  const activeIndex = steps.findIndex(([key]) => key === stage);
  return <section className="import-confirmation">
    <header><div><span>{preview.kind === "workbook" ? "EXCEL PREVIEW" : preview.kind === "web" ? "WEB PREVIEW" : "DOCUMENT PREVIEW"}</span><h2>{preview.title}</h2><p>{preview.warning || "检查内容后再确认导入。"}</p></div><button className="icon-only" type="button" aria-label="取消导入" disabled={busy} onClick={onCancel}><X /></button></header>
    {preview.worksheets && <div className="worksheet-picker">{preview.worksheets.map((sheet) => <label key={sheet.name}><input type="checkbox" checked={selectedSheets.includes(sheet.name)} onChange={(event) => toggleSheet(sheet.name, event.target.checked)} /><span><strong>{sheet.name}</strong><small>{sheet.rowCount} 行 · {sheet.columnCount} 列</small></span></label>)}</div>}
    <div className="import-mode"><span>写入方式</span><button type="button" className={mode === "append" ? "active" : ""} onClick={() => onMode("append")}>追加到正文</button><button type="button" className={mode === "replace" ? "active" : ""} onClick={() => onMode("replace")}>替换正文</button></div>
    <div className="import-preview-scroll"><RichContent html={composed.bodyHtml} className="reader-body import-preview-body" /></div>
    {preview.wordImages && <div className="word-import-summary"><strong>{preview.wordImages.count} 张原图</strong><span>{formatBytes(preview.wordImages.totalOriginalBytes)} · 保留原始像素、尺寸和文件格式</span></div>}
    {preview.wordImages && <div className="document-import-status" aria-live="polite"><div>{steps.map(([key, label], index) => <span className={stage === "complete" || (activeIndex >= index && activeIndex !== -1) ? "done" : ""} key={key}>{label}</span>)}</div>{jobId && <small>导入任务：{jobId}</small>}{currentImage > 0 && <small>当前图片：{currentImage}/{preview.wordImages.count}，服务器已登记：{registeredImages}/{preview.wordImages.count}{retries > 0 ? `，重试 ${retries} 次` : ""}</small>}{failure && <p role="alert">{failure}</p>}</div>}
    {progress > 0 && <div className="upload-progress"><span style={{ width: `${progress}%` }} /><strong>正在上传原始图片 {progress}%</strong></div>}
    <footer><span>{preview.kind === "web" ? "网页来源会记录在后台" : preview.wordImages && preview.wordImages.totalOriginalBytes > 100 * 1024 * 1024 ? "正文和图片会保存，超限的原始 Word 不保存为附件" : "确认后原文件会同时保存为私有附件"}</span><button className="button quiet" type="button" disabled={busy} onClick={onCancel}>取消</button><button className="button primary" type="button" disabled={busy || Boolean(preview.worksheets && !selectedSheets.length)} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <Check />}{busy ? "正在导入" : "确认导入"}</button></footer>
  </section>;
}

function DraftPreview({ draft, item, media }: { draft: ContentDraft; item: ContentItem; media: ContentMedia[] }) {
  return <article className="draft-preview"><header><span>{item.categoryName}</span><h1>{draft.title}</h1><p>{draft.summary}</p></header><RichContent html={draft.bodyHtml} media={media} /></article>;
}

type MediaRow = Record<string, unknown> & { id: string; storage_bucket: string | null; storage_path: string | null; external_url: string | null; mime_type?: string | null; previewUrl?: string };
type MediaFilter = "gallery" | "document" | "video" | "attachments";
const mediaPageSize = 30;

function mediaProvider(row: MediaRow) {
  if (row.storage_provider === "tencent_cos") return { key: "cos", label: "腾讯 COS" };
  if (row.video_provider === "tencent_vod") return { key: "external", label: "腾讯 VOD" };
  if (row.external_url && !row.storage_path) return { key: "external", label: "外部链接" };
  return { key: "supabase", label: "旧 Supabase" };
}

function mediaRowToEditorMedia(row: MediaRow): RichEditorMedia {
  return {
    id: row.id,
    kind: row.kind === "video" ? "video" : "image",
    src: String(row.previewUrl || row.playback_url || row.external_url || ""),
    title: String(row.title || (row.kind === "video" ? "视频" : "图片")),
    altText: String(row.alt_text || row.title || ""),
    mimeType: String(row.mime_type || (row.kind === "video" ? "video/mp4" : "image/webp")),
    posterUrl: row.posterPreviewUrl ? String(row.posterPreviewUrl) : row.poster_url ? String(row.poster_url) : undefined,
    width: Number(row.width || 0) || undefined,
    height: Number(row.height || 0) || undefined
  };
}

async function loadMediaRecords(contentId: string, page: number, filter: MediaFilter): Promise<{ items: MediaRow[]; total: number }> {
  const from = (page - 1) * mediaPageSize;
  if (filter === "attachments") {
    const result = await supabase.from("attachments").select("*", { count: "exact" }).eq("content_id", contentId).order("sort_order").range(from, from + mediaPageSize - 1);
    if (result.error) throw result.error;
    return { items: (result.data || []) as MediaRow[], total: result.count || 0 };
  }
  let request = supabase.from("content_media").select("*", { count: "exact" }).eq("content_id", contentId);
  if (filter === "document") request = request.eq("kind", "image").not("source_import_id", "is", null);
  if (filter === "gallery") request = request.eq("kind", "image").is("source_import_id", null);
  if (filter === "video") request = request.eq("kind", "video");
  const media = await request.order("sort_order").range(from, from + mediaPageSize - 1);
  if (media.error) throw media.error;
  const withUrls = await Promise.all((media.data || []).map(async (row) => {
    let previewUrl = row.external_url || "";
    let posterPreviewUrl = row.poster_url || "";
    if (row.storage_bucket === publicMediaBucket && row.storage_path) previewUrl = publicAssetUrl(row.storage_path);
    if (row.storage_bucket === privateMediaBucket && row.storage_path) {
      const signed = await supabase.storage.from(privateMediaBucket).createSignedUrl(row.storage_path, 3600);
      if (signed.error) throw signed.error;
      previewUrl = signed.data.signedUrl;
    }
    if (row.storage_provider === "tencent_cos" && row.storage_bucket === cosPublicBucket && row.storage_path) previewUrl = publicAssetUrl(row.storage_path, "tencent_cos");
    if (row.storage_provider === "tencent_cos" && row.storage_bucket === cosPrivateBucket && row.storage_path) {
      const signed = await invokeEdgeFunction<{ url?: string }>("cos-storage", { action: "signed-url", bucket: cosPrivateBucket, path: row.storage_path, contentId }, "signed-url");
      previewUrl = String(signed.url || "");
    }
    if (!posterPreviewUrl && row.poster_storage_path) {
      if (row.storage_provider === "tencent_cos" && row.storage_bucket === cosPublicBucket) posterPreviewUrl = publicAssetUrl(row.poster_storage_path, "tencent_cos");
      else if (row.storage_provider === "tencent_cos" && row.storage_bucket === cosPrivateBucket) {
        const signedPoster = await invokeEdgeFunction<{ url?: string }>("cos-storage", { action: "signed-url", bucket: cosPrivateBucket, path: row.poster_storage_path, contentId }, "signed-poster-url");
        posterPreviewUrl = String(signedPoster.url || "");
      } else if (row.storage_bucket === publicMediaBucket) posterPreviewUrl = publicAssetUrl(row.poster_storage_path);
      else if (row.storage_bucket === privateMediaBucket) posterPreviewUrl = (await supabase.storage.from(privateMediaBucket).createSignedUrl(row.poster_storage_path, 3600)).data?.signedUrl || "";
    }
    return { ...row, previewUrl, posterPreviewUrl } as MediaRow;
  }));
  return { items: withUrls, total: media.count || 0 };
}

function CosUploadProbe({ contentId, profile, onMessage }: { contentId: string; profile: Profile; onMessage(value: string, error?: boolean): void }) {
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("");
  if (!cosStorageEnabled || !["super_admin", "editor"].includes(profile.role)) return null;

  const run = async () => {
    if (running) return;
    setRunning(true);
    const probeId = randomId();
    const probes = [
      { name: "PutObject", file: new Blob(["maplestorynk-cos-probe"], { type: "application/octet-stream" }) },
      { name: "MultipartUpload", file: new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "application/octet-stream" }) }
    ];
    const paths: string[] = [];
    try {
      for (const [index, probe] of probes.entries()) {
        setStage(`${probe.name} ${index + 1}/${probes.length}`);
        const path = `drafts/${contentId}/probes/${probeId}-${index + 1}.bin`;
        const stored = await uploadManagedFile({ file: probe.file, path, purpose: "content-media", contentId, visibility: "private" });
        paths.push(stored.path);
        const verified = await invokeEdgeFunction<{ sizeBytes: number }>("cos-storage", { action: "head", bucket: stored.bucket, path: stored.path, contentId }, "probe-head");
        if (Number(verified.sizeBytes) !== probe.file.size) throw new Error(`${probe.name} object size verification failed`);
      }
      await removeStoredObjects({ provider: "tencent_cos", bucket: cosPrivateBucket, paths, contentId });
      paths.length = 0;
      onMessage("COS 上传检查通过：普通上传、分片上传、对象核验和清理均正常。");
      void reportRuntimeLog({ source: "cos-upload-probe", severity: "info", message: "COS upload probe passed", context: { bucket: cosPrivateBucket, smallBytes: probes[0].file.size, multipartBytes: probes[1].file.size } });
    } catch (error) {
      const context = error instanceof CosUploadError
        ? { probe: true, fileSize: probes[1].file.size, ...error.details }
        : error instanceof EdgeFunctionError
        ? error.toLogContext({ probe: true, bucket: cosPrivateBucket })
        : { probe: true, bucket: cosPrivateBucket };
      void reportRuntimeLog({ source: "cos-upload-probe", message: messageOf(error, "COS 上传检查失败"), error, context });
      onMessage(messageOf(error, "COS 上传检查失败"), true);
    } finally {
      if (paths.length) void removeStoredObjects({ provider: "tencent_cos", bucket: cosPrivateBucket, paths, contentId });
      setRunning(false);
      setStage("");
    }
  };

  return <div className="media-probe-actions"><button className="button quiet" type="button" disabled={running} onClick={run}>{running ? <LoaderCircle className="spin" /> : <Gauge />}{running ? `检查中 ${stage}` : "检查 COS 上传"}</button></div>;
}

export function ContentMediaManager({ contentId, profile, autoPublish = false, publishVersion, onInsert, onRemoveFromBody, onReplaceInBody, onChanged }: { contentId: string; profile: Profile; autoPublish?: boolean; publishVersion?: number; onInsert(media: RichEditorMedia): void; onRemoveFromBody(mediaId: string): void | Promise<void>; onReplaceInBody(media: RichEditorMedia): void; onChanged(): void | Promise<void> }) {
  const client = useQueryClient(); const [filter, setFilter] = useState<MediaFilter>("gallery"); const [page, setPage] = useState(1); const mediaKey = ["admin-media", contentId, filter, page] as const; const records = useQuery({ queryKey: mediaKey, queryFn: () => loadMediaRecords(contentId, page, filter), enabled: Boolean(contentId), placeholderData: (previous) => previous });
  const [progress, setProgress] = useState(0); const [uploadStage, setUploadStage] = useState(""); const [message, setMessage] = useState(""); const [errorState, setErrorState] = useState(false); const controller = useRef<AbortController | null>(null); const [dragging, setDragging] = useState<string | null>(null); const [variantBusyId, setVariantBusyId] = useState<string | null>(null);
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["admin-media", contentId] }); await onChanged(); };
  const notify = (value: string, error = false) => { setMessage(value); setErrorState(error); };
  const upload = async (files: File[]) => {
    controller.current = new AbortController();
    try {
      const [mediaCountResult, attachmentCountResult] = await Promise.all([
        supabase.from("content_media").select("id", { count: "exact", head: true }).eq("content_id", contentId),
        supabase.from("attachments").select("id", { count: "exact", head: true }).eq("content_id", contentId)
      ]);
      if (mediaCountResult.error) throw mediaCountResult.error;
      if (attachmentCountResult.error) throw attachmentCountResult.error;
      let nextMediaOrder = (mediaCountResult.count || 0) * 10 + 10;
      let nextAttachmentOrder = (attachmentCountResult.count || 0) * 10 + 10;
      let convertedVideos = 0;
      for (const [index, file] of files.entries()) {
        const type = validateUpload(file);
        const preparedVideo = type.video ? await prepareBrowserVideo(file, (value) => {
          setUploadStage(`${browserVideoStageText(value)} ${index + 1}/${files.length}`);
          setProgress(Math.round(((index + value.percent / 100 * 0.55) / files.length) * 100));
        }) : null;
        const prepared = type.image ? await imageToWebp(file) : preparedVideo?.video || file;
        if (preparedVideo?.converted) convertedVideos += 1;
        setUploadStage(type.video ? `正在上传兼容视频 ${index + 1}/${files.length}` : `正在上传 ${index + 1}/${files.length}`);
        const path = cosStorageEnabled
          ? `drafts/${contentId}/media/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
          : `${profile.id}/${contentId}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
        const stored = await uploadManagedFile({
          file: prepared, path, purpose: "content-media", contentId, visibility: "private", signal: controller.current.signal,
          onProgress: (value) => setProgress(Math.round(((index + (0.55 + value.percent / 100 * 0.37)) / files.length) * 100))
        });
        let storedPoster: Awaited<ReturnType<typeof uploadManagedFile>> | null = null;
        try {
          if (preparedVideo) {
            setUploadStage(`正在上传视频封面 ${index + 1}/${files.length}`);
            storedPoster = await uploadManagedFile({
              file: preparedVideo.poster,
              path: videoPosterPath(path),
              purpose: "content-media",
              contentId,
              visibility: "private",
              signal: controller.current.signal,
              onProgress: (value) => setProgress(Math.round(((index + (0.92 + value.percent / 100 * 0.08)) / files.length) * 100))
            });
          }
        } catch (error) {
          await removeStoredObjects({ provider: stored.provider, bucket: stored.bucket, paths: [stored.path], contentId });
          throw error;
        }
        const sortOrder = type.document ? nextAttachmentOrder : nextMediaOrder;
        const base = { content_id: contentId, storage_provider: stored.provider, storage_bucket: stored.bucket, storage_path: stored.path, sort_order: sortOrder, created_by: profile.id, mime_type: type.video ? normalizedVideoMimeType(prepared) || prepared.type || "video/mp4" : prepared.type || "application/octet-stream", size_bytes: prepared.size };
        const dimensions = type.image ? await imageDimensions(prepared) : preparedVideo ? { width: preparedVideo.width, height: preparedVideo.height } : {};
        if (type.document) {
          const result = await supabase.from("attachments").insert({ ...base, name: file.name });
          if (result.error) { await removeStoredObjects({ provider: stored.provider, bucket: stored.bucket, paths: [stored.path], contentId }); throw result.error; }
        } else {
          const result = await supabase.from("content_media").insert({ ...base, kind: type.video ? "video" : "image", title: file.name.replace(/\.[^.]+$/, ""), alt_text: file.name, processing_status: "ready", video_codec: preparedVideo?.codec || null, duration_ms: preparedVideo?.durationMs || null, poster_storage_path: storedPoster?.path || null, placement_status: "unplaced", ...dimensions }).select("id").single();
          if (result.error || !result.data) { await removeStoredObjects({ provider: stored.provider, bucket: stored.bucket, paths: [stored.path, storedPoster?.path].filter(Boolean).map(String), contentId }); throw result.error || new Error("媒体登记失败"); }
        }
        if (type.document) nextAttachmentOrder += 10;
        else nextMediaOrder += 10;
      }
      const uploadedFilter: MediaFilter = files.some((file) => validateUpload(file).video)
        ? "video"
        : files.some((file) => validateUpload(file).image)
          ? "gallery"
          : "attachments";
      setFilter(uploadedFilter);
      setPage(1);
      if (autoPublish && publishVersion) {
        setUploadStage("上传完成，正在发布媒体更新");
        try {
          await publishContent(contentId, publishVersion);
          notify(`已上传并发布 ${files.length} 个文件${convertedVideos ? `，其中 ${convertedVideos} 个视频已在本机转换为 H.264/AAC` : ""}。`);
        } catch (publishError) {
          void reportRuntimeLog({ source: "publish-content", message: messageOf(publishError, "媒体自动发布失败"), error: publishError, context: { contentId, fileCount: files.length } });
          notify(`文件已安全上传，但自动发布失败：${messageOf(publishError)}。请点击右上角“发布媒体更新”重试。`, true);
        }
      } else {
        notify(`已上传 ${files.length} 个文件到草稿区${convertedVideos ? `，其中 ${convertedVideos} 个视频已在本机完成兼容转换` : ""}。请点击右上角“发布媒体更新”，公开页面才会显示。`);
      }
      await refresh();
    } catch (error) {
      const context = error instanceof CosUploadError
        ? { contentId, fileCount: files.length, provider: "tencent_cos", fileSize: files.reduce((total, file) => total + file.size, 0), ...error.details }
        : error instanceof EdgeFunctionError
        ? error.toLogContext({ contentId, fileCount: files.length, provider: cosStorageEnabled ? "tencent_cos" : "supabase" })
        : { contentId, fileCount: files.length, provider: cosStorageEnabled ? "tencent_cos" : "supabase" };
      void reportRuntimeLog({ source: error instanceof EdgeFunctionError ? error.functionName : "upload", message: messageOf(error, "上传失败"), error, context });
      notify(error instanceof DOMException && error.name === "AbortError" ? "上传已取消。" : messageOf(error, "上传失败"), true);
    } finally { controller.current = null; setProgress(0); setUploadStage(""); }
  };
  const generateVariants = async (row: MediaRow) => {
    if (row.kind !== "image" || !row.id || variantBusyId) return;
    const originalPath = String(row.original_storage_path || row.storage_path || "");
    let originalUrl = String(row.previewUrl || "");
    if (originalPath && originalPath !== row.storage_path) {
      if (row.storage_provider === "tencent_cos" && row.storage_bucket === cosPrivateBucket) {
        const signed = await supabase.functions.invoke("cos-storage", { body: { action: "signed-url", bucket: cosPrivateBucket, path: originalPath, contentId } });
        originalUrl = signed.data?.url || "";
      } else if (row.storage_bucket === privateMediaBucket) {
        originalUrl = (await supabase.storage.from(privateMediaBucket).createSignedUrl(originalPath, 3600)).data?.signedUrl || "";
      } else {
        originalUrl = publicAssetUrl(originalPath, String(row.storage_provider || "supabase"));
      }
    }
    if (!originalUrl) return notify("找不到原始图片，无法生成预览。", true);
    setVariantBusyId(row.id);
    const createdPaths: string[] = [];
    try {
      const response = await fetch(originalUrl);
      if (!response.ok) throw new Error(`原图读取失败（HTTP ${response.status}）`);
      const source = new File([await response.blob()], String(row.title || "image.png"), { type: String(row.original_mime_type || row.mime_type || "image/png") });
      const variants = [];
      for (const maxSide of [960, 1600]) {
        const result = await imageToWebpVariant(source, maxSide, 0.92);
        const path = cosStorageEnabled
          ? `drafts/${contentId}/previews/${row.id}-${maxSide}-${randomId()}.webp`
          : `${profile.id}/${contentId}/previews/${row.id}-${maxSide}.webp`;
        createdPaths.push(path);
        await uploadManagedFile({ file: result.file, path, purpose: "content-media", contentId, visibility: "private", upsert: !cosStorageEnabled, onProgress: (value) => setProgress(value.percent) });
        variants.push({ key: String(maxSide), path, width: result.width, height: result.height, mimeType: result.file.type, sizeBytes: result.file.size });
      }
      const display = variants[1] || variants[0];
      const { error } = await supabase.from("content_media").update({
        storage_provider: cosStorageEnabled ? "tencent_cos" : "supabase",
        storage_bucket: cosStorageEnabled ? cosPrivateBucket : privateMediaBucket,
        original_storage_path: originalPath,
        image_variants: variants,
        storage_path: display.path,
        display_storage_path: display.path,
        size_bytes: display.sizeBytes,
        width: display.width,
        height: display.height,
        mime_type: "image/webp",
        image_variant_status: "ready"
      }).eq("id", row.id);
      if (error) throw error;
      notify(`已为“${String(row.title || "图片")}”生成 960/1600px 预览，原图保持不变。`);
      await refresh();
    } catch (error) {
      if (createdPaths.length) void removeStoredObjects({ provider: cosStorageEnabled ? "tencent_cos" : "supabase", bucket: cosStorageEnabled ? cosPrivateBucket : privateMediaBucket, paths: createdPaths, contentId });
      void reportRuntimeLog({ source: "media-variants", message: messageOf(error, "图片预览生成失败"), error, context: { contentId, mediaId: row.id } });
      await supabase.from("content_media").update({ image_variant_status: "failed" }).eq("id", row.id);
      notify(messageOf(error, "图片预览生成失败"), true);
    } finally { setVariantBusyId(null); setProgress(0); }
  };
  const remove = async (table: "content_media" | "attachments", row: MediaRow) => {
    if (!window.confirm("确定删除这个文件吗？此操作无法撤销。")) return;
    if (table === "content_media") {
      try { await onRemoveFromBody(row.id); }
      catch (error) { return notify(messageOf(error, "正文更新失败，媒体没有删除"), true); }
    }
    const previous = client.getQueryData<{ items: MediaRow[]; total: number }>(mediaKey);
    client.setQueryData<{ items: MediaRow[]; total: number }>(mediaKey, (current) => current ? { items: current.items.filter((item) => item.id !== row.id), total: Math.max(0, current.total - 1) } : current);
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) { client.setQueryData(mediaKey, previous); return notify(error.message, true); }
    notify("文件已删除，存储文件正在后台清理。");
    void onChanged();
    const variantPaths = Array.isArray(row.image_variants) ? row.image_variants.flatMap((variant) => variant && typeof variant === "object" && "path" in variant ? [String(variant.path)] : []) : [];
    const storedPaths = [row.storage_path, row.original_storage_path, row.display_storage_path, row.poster_storage_path, ...variantPaths].filter(Boolean).map(String);
    if (row.storage_bucket && storedPaths.length) void removeStoredObjects({ provider: String(row.storage_provider || "supabase"), bucket: row.storage_bucket, paths: storedPaths, contentId }).catch((storageError) => {
      void reportRuntimeLog({ source: "storage-cleanup", message: messageOf(storageError, "存储文件清理失败"), error: storageError, context: { table, recordId: row.id, provider: row.storage_provider } });
    });
    if (row.pending_storage_bucket && row.pending_storage_path) void removeStoredObjects({ provider: String(row.pending_storage_provider || "tencent_cos"), bucket: String(row.pending_storage_bucket), paths: [String(row.pending_storage_path)], contentId });
  };
  const replace = async (row: MediaRow, file: File) => {
    let stored: Awaited<ReturnType<typeof uploadManagedFile>> | null = null;
    let storedPoster: Awaited<ReturnType<typeof uploadManagedFile>> | null = null;
    try {
      const type = validateUpload(file);
      if (row.kind === "video" && !type.video) throw new Error("请选择视频文件进行替换。");
      if (row.kind === "image" && !type.image) throw new Error("请选择图片文件进行替换。");
      const preparedVideo = type.video ? await prepareBrowserVideo(file, (value) => {
        setUploadStage(`${browserVideoStageText(value)}“${String(row.title || file.name)}”`);
        setProgress(Math.round(value.percent * 0.6));
      }) : null;
      const prepared = type.image ? await imageToWebp(file) : preparedVideo?.video || file;
      const path = cosStorageEnabled
        ? `drafts/${contentId}/media/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`
        : `${profile.id}/${contentId}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      setUploadStage(`正在验证并替换“${String(row.title || file.name)}”`);
      stored = await uploadManagedFile({ file: prepared, path, purpose: "content-media", contentId, visibility: "private", onProgress: (value) => setProgress(preparedVideo ? 60 + Math.round(value.percent * 0.3) : value.percent) });
      if (preparedVideo) {
        storedPoster = await uploadManagedFile({ file: preparedVideo.poster, path: videoPosterPath(path), purpose: "content-media", contentId, visibility: "private", onProgress: (value) => setProgress(90 + Math.round(value.percent * 0.1)) });
      }
      const dimensions = type.image ? await imageDimensions(prepared) : preparedVideo ? { width: preparedVideo.width, height: preparedVideo.height } : {};
      const { data, error } = await supabase.from("content_media").update({
        pending_storage_provider: stored.provider,
        pending_storage_bucket: stored.bucket,
        pending_storage_path: stored.path,
        pending_mime_type: type.video ? normalizedVideoMimeType(prepared) || prepared.type || "video/mp4" : prepared.type,
        pending_size_bytes: prepared.size,
        pending_width: "width" in dimensions ? dimensions.width : null,
        pending_height: "height" in dimensions ? dimensions.height : null,
        processing_status: row.processing_status || "ready"
      }).eq("id", row.id).select("*").single();
      if (error || !data) {
        await removeStoredObjects({ provider: stored.provider, bucket: stored.bucket, paths: [stored.path, storedPoster?.path].filter(Boolean).map(String), contentId });
        throw error || new Error("媒体替换登记失败");
      }
      const committed = await invokeEdgeFunction<{ previewUrl?: string; posterUrl?: string; storageBucket?: string; storagePath?: string; posterStoragePath?: string; mimeType?: string; sizeBytes?: number }>("video-transcode", {
        action: "commit-replacement",
        contentId,
        mediaId: row.id,
        posterPath: storedPoster?.path || "",
        videoCodec: preparedVideo?.codec || "",
        durationMs: preparedVideo?.durationMs || 0
      }, "commit-media-replacement");
      onReplaceInBody(mediaRowToEditorMedia({ ...data, storage_bucket: committed.storageBucket, storage_path: committed.storagePath, poster_storage_path: committed.posterStoragePath, mime_type: committed.mimeType, size_bytes: committed.sizeBytes, video_codec: preparedVideo?.codec || null, duration_ms: preparedVideo?.durationMs || null, previewUrl: committed.previewUrl, posterPreviewUrl: committed.posterUrl } as MediaRow));
      stored = null;
      storedPoster = null;
      notify(preparedVideo?.converted ? "视频已在本机转换并完成原子替换，正文位置和说明保持不变。" : "替换文件已核验，正文位置和说明保持不变。请保存或发布。");
      await refresh();
    } catch (error) {
      if (stored) void removeStoredObjects({ provider: stored.provider, bucket: stored.bucket, paths: [stored.path, storedPoster?.path].filter(Boolean).map(String), contentId }).catch((cleanupError) => {
        void reportRuntimeLog({ source: "browser-video-cleanup", message: messageOf(cleanupError, "Failed to clean up a rejected video replacement"), error: cleanupError, context: { contentId, mediaId: row.id, provider: stored?.provider } });
      });
      await supabase.from("content_media").update({ pending_storage_provider: null, pending_storage_bucket: null, pending_storage_path: null, pending_mime_type: null, pending_size_bytes: null, pending_width: null, pending_height: null }).eq("id", row.id);
      void reportRuntimeLog({ source: "browser-video-replacement", message: messageOf(error, "视频本机处理或替换失败"), error, context: { contentId, mediaId: row.id, fileSize: file.size, mimeType: file.type, provider: cosStorageEnabled ? "tencent_cos" : "supabase" } });
      notify(messageOf(error, "替换失败，旧文件仍保持可用"), true);
    } finally {
      setProgress(0);
      setUploadStage("");
    }
  };
  const insertIntoBody = async (row: MediaRow) => {
    const { error } = await supabase.from("content_media").update({ placement_status: "inserted" }).eq("id", row.id).eq("content_id", contentId);
    if (error) return notify(messageOf(error, "无法登记正文位置"), true);
    onInsert(mediaRowToEditorMedia(row));
  };
  const retryTranscode = async (row: MediaRow) => {
    try {
      if (!row.previewUrl) throw new Error("找不到原始视频，无法在本机修复");
      setUploadStage(`正在读取“${String(row.title || "视频")}”的原始文件`);
      const response = await fetch(String(row.previewUrl));
      if (!response.ok) throw new Error(`原始视频读取失败（HTTP ${response.status}）`);
      const source = new File([await response.blob()], `${String(row.title || "video")}.mp4`, { type: String(row.mime_type || "video/mp4") });
      await replace(row, source);
    } catch (error) {
      notify(messageOf(error, "视频本机修复失败"), true);
    }
  };
  const reorder = async (targetId: string) => { if (filter !== "gallery" || !dragging || dragging === targetId || !records.data) return; const rows = [...records.data.items]; const from = rows.findIndex((row) => row.id === dragging); const to = rows.findIndex((row) => row.id === targetId); const [moved] = rows.splice(from, 1); rows.splice(to, 0, moved); setDragging(null); client.setQueryData(mediaKey, { ...records.data, items: rows }); try { const items = rows.map((row, index) => ({ id: row.id, sortOrder: ((page - 1) * mediaPageSize + index + 1) * 10 })); const { error } = await supabase.rpc("reorder_content_media", { p_content_id: contentId, p_items: items }); if (error) throw error; notify("媒体顺序已保存。"); } catch (error) { notify(messageOf(error, "排序失败"), true); await refresh(); } };
  if (records.isLoading) return <AdminLoading label="正在读取媒体" />;
  const total = records.data?.total || 0; const pages = Math.max(1, Math.ceil(total / mediaPageSize));
  const legacyOnPage = records.data?.items.filter((row) => mediaProvider(row).key === "supabase" && Boolean(row.storage_path)).length || 0;
  return <div className="media-workspace"><AdminToast message={message} error={errorState} onClose={() => setMessage("")} /><CosUploadProbe contentId={contentId} profile={profile} onMessage={notify} /><label className="drop-zone"><Upload /><strong>批量上传图片、视频或附件</strong><span>不兼容视频会在当前电脑转换为 H.264/AAC，再上传腾讯云 COS；不使用轻量服务器</span><b>选择本地文件</b><input className="visually-hidden-file" type="file" multiple accept="image/*,video/*,.mp4,.mov,.m4v,.mkv,.avi,.webm,.pdf,.zip,.docx,.txt" disabled={!canEdit(profile.role) || Boolean(controller.current)} onChange={(event) => { const files = [...(event.target.files || [])]; if (files.length) upload(files); event.target.value = ""; }} /></label>{progress > 0 && <div className="upload-progress"><span style={{ width: `${progress}%` }} /><strong>{uploadStage || `${progress}%`}</strong></div>}
    {legacyOnPage > 0 && <div className="media-source-banner warning"><Database /><span><strong>当前页有 {legacyOnPage} 个旧 Supabase 文件</strong><small>这些文件不会经过腾讯云加速。Word 正文请重新导入，普通媒体请重新上传。</small></span></div>}
    <div className="media-filter-tabs">{(["gallery", "document", "video", "attachments"] as MediaFilter[]).map((key) => <button type="button" className={filter === key ? "active" : ""} key={key} onClick={() => { setFilter(key); setPage(1); }}>{({ gallery: "图库", document: "正文图片", video: "视频", attachments: "附件" } as Record<MediaFilter, string>)[key]}</button>)}</div>
    {filter !== "attachments" ? <div className={filter === "video" ? "media-video-list" : "media-library-grid"}>{records.data?.items.map((row) => <MediaCard key={row.id} row={row} editable={canEdit(profile.role)} draggable={filter === "gallery" && canEdit(profile.role)} dragging={dragging === row.id} onDrag={() => setDragging(row.id)} onDrop={() => reorder(row.id)} onInsert={() => insertIntoBody(row)} onReplace={(file) => replace(row, file)} onRetry={() => retryTranscode(row)} onSaved={refresh} onRemove={() => remove("content_media", row)} onGenerateVariants={() => generateVariants(row)} variantBusy={variantBusyId === row.id} onMessage={notify} />)}{!records.data?.items.length && <AdminEmpty icon={<ImagePlus />} title="当前分类暂无媒体" detail="可从上方选择本地文件上传。" />}</div>
      : <section className="attachment-section">{records.data?.items.map((row) => { const provider = mediaProvider(row); return <div className="attachment-row" key={row.id}><FileText /><div><strong>{String(row.name || "附件")}</strong><span>{String(row.mime_type || "文件")} · {formatBytes(Number(row.size_bytes || 0))}</span></div><span className={`media-provider-badge ${provider.key}`}>{provider.label}</span>{canEdit(profile.role) && <button className="icon-only danger" onClick={() => remove("attachments", row)}><Trash2 /></button>}</div>; })}{!records.data?.items.length && <AdminEmpty title="暂无附件" />}</section>}
    {pages > 1 && <div className="pagination"><span>共 {total} 条</span><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button><strong>{page} / {pages}</strong><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button></div>}</div>;
}

function MediaCard({ row, editable, draggable, dragging, onDrag, onDrop, onInsert, onReplace, onRetry, onSaved, onRemove, onGenerateVariants, variantBusy, onMessage }: { row: MediaRow; editable: boolean; draggable: boolean; dragging: boolean; onDrag(): void; onDrop(): void; onInsert(): void; onReplace(file: File): void; onRetry(): void; onSaved(): void; onRemove(): void; onGenerateVariants(): void; variantBusy: boolean; onMessage(value: string, error?: boolean): void }) {
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(String(row.title || "")); const [note, setNote] = useState(String(row.note || "")); const [path, setPath] = useState(Array.isArray(row.hierarchy_path) ? row.hierarchy_path.join(" / ") : "");
  const provider = mediaProvider(row);
  const save = async () => { const { error } = await supabase.from("content_media").update({ title: title.trim(), note: note.trim(), hierarchy_path: path.split("/").map((part) => part.trim()).filter(Boolean), alt_text: title.trim() }).eq("id", row.id); if (error) onMessage(error.message, true); else { onMessage("媒体信息已保存。"); onSaved(); } };
  const hasPlayableFallback = Boolean(row.pending_storage_path && row.storage_path && row.pending_storage_path !== row.storage_path && row.previewUrl);
  const playerMedia = { src: String(row.previewUrl || ""), title, mimeType: String(row.mime_type || ""), posterUrl: String(row.posterPreviewUrl || row.poster_url || "") || undefined, processingStatus: (hasPlayableFallback ? "ready" : String(row.processing_status || "ready")) as "ready" | "processing" | "failed", videoProvider: row.video_provider === "tencent_vod" ? "tencent_vod" as const : undefined, providerFileId: row.provider_file_id ? String(row.provider_file_id) : undefined, providerAppId: row.provider_app_id ? String(row.provider_app_id) : undefined };
  const needsVariants = row.kind === "image" && (!Array.isArray(row.image_variants) || row.image_variants.length === 0);
  const videoCodec = String(row.video_codec || "").trim();
  const needsLocalRepair = row.kind === "video" && (String(row.processing_status || "ready") !== "ready" || !videoCodec || videoCodec === "browser-incompatible");
  const statusText = needsLocalRepair ? "等待本机兼容修复" : hasPlayableFallback ? "旧版本可用" : "可用";
  return <article className={`media-card${row.kind === "video" ? " video" : ""}${dragging ? " dragging" : ""}`} draggable={draggable} onDragStart={draggable ? onDrag : undefined} onDragOver={draggable ? (event) => event.preventDefault() : undefined} onDrop={draggable ? onDrop : undefined}><div className="media-card-preview">{row.kind === "video" ? <div className="media-video-shell"><VideoPlayer media={playerMedia} /></div> : row.previewUrl ? <img src={row.previewUrl} alt={title} loading="lazy" decoding="async" /> : <FileImage />}</div><div className="media-card-fields"><div className="media-card-status"><span className={`media-provider-badge ${provider.key}`}>{provider.label}</span><span>{statusText}</span></div><input disabled={!editable} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="媒体名称" /><input disabled={!editable} value={path} onChange={(event) => setPath(event.target.value)} placeholder="一级 / 二级 / 三级" /><textarea disabled={!editable} value={note} onChange={(event) => setNote(event.target.value)} placeholder="媒体标注或说明" />{row.kind === "video" && <small>{String(row.video_codec || "编码待检测")} · {formatBytes(Number(row.size_bytes || 0))}</small>}</div>{editable && <div className="media-card-actions"><input ref={replaceRef} className="sr-only" type="file" accept={row.kind === "video" ? "video/*,.mp4,.mov,.m4v,.mkv,.avi,.webm" : "image/*"} onChange={(event) => { const file = event.target.files?.[0]; if (file) onReplace(file); event.target.value = ""; }} /><button className="media-action-labeled" title="插入正文" disabled={String(row.processing_status || "ready") !== "ready"} onClick={onInsert}><Plus />插入正文</button><button className="media-action-labeled" title="替换文件" onClick={() => replaceRef.current?.click()}><RefreshCcw />替换</button>{needsLocalRepair && <button className="media-action-labeled" title="在当前电脑转换并修复视频" onClick={onRetry}><RefreshCcw />本机修复</button>}{needsVariants && <button title="生成响应式预览" disabled={variantBusy} onClick={onGenerateVariants}>{variantBusy ? <LoaderCircle className="spin" /> : <ImagePlus />}</button>}<button title="保存信息" onClick={save}><Save /></button><button className="danger" title="永久删除" onClick={onRemove}><Trash2 /></button></div>}</article>;
}

export function CategoriesPage({ profile }: { profile: Profile }) {
  const client = useQueryClient(); const categories = useAdminCategories(); const counts = useQuery({ queryKey: ["admin-category-counts"], queryFn: loadAdminCategoryCounts, staleTime: 60_000 });
  const [message, setMessage] = useState(""); const [errorState, setErrorState] = useState(false); const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [dragging, setDragging] = useState<string | null>(null);
  const refresh = () => { client.invalidateQueries({ queryKey: ["admin-categories"] }); client.invalidateQueries({ queryKey: ["public-home"] }); client.invalidateQueries({ queryKey: ["public-category"] }); };
  const notify = (value: string, error = false) => { setMessage(value); setErrorState(error); };
  const create = async (event: React.FormEvent) => { event.preventDefault(); const { error } = await supabase.from("categories").insert({ name: name.trim(), slug: slugify(name), description, sort_order: ((categories.data?.length || 0) + 1) * 10, created_by: profile.id, updated_by: profile.id }); if (error) return notify(error.message, true); setName(""); setDescription(""); notify("分类已创建。"); refresh(); };
  const reorder = async (targetId: string) => { if (!dragging || dragging === targetId || !categories.data) return; const rows = [...categories.data]; const from = rows.findIndex((row) => row.id === dragging); const to = rows.findIndex((row) => row.id === targetId); const [moved] = rows.splice(from, 1); rows.splice(to, 0, moved); setDragging(null); try { const { error } = await supabase.rpc("reorder_categories", { p_items: rows.map((row, index) => ({ id: row.id, sortOrder: (index + 1) * 10 })) }); if (error) throw error; client.setQueryData(["admin-categories"], rows.map((row, index) => ({ ...row, sortOrder: (index + 1) * 10 }))); notify("分类顺序已保存。"); } catch (error) { notify(messageOf(error, "排序失败"), true); refresh(); } };
  return <div className="admin-page-stack"><AdminToast message={message} error={errorState} onClose={() => setMessage("")} /><AdminPageHeader title="分类管理" description="拖动排序，管理封面、文字和显示状态。" />{canPublish(profile.role) && <form className="admin-inline-create" onSubmit={create}><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="新分类名称" /><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="分类说明" /><button className="button primary"><Plus />创建分类</button></form>}<section className="category-manager">{categories.data?.map((category) => <CategoryManagerRow key={category.id} category={category} count={counts.data?.get(category.id) || 0} profile={profile} dragging={dragging === category.id} onDrag={() => setDragging(category.id)} onDrop={() => reorder(category.id)} onSaved={refresh} onMessage={notify} />)}{!categories.data?.length && <AdminEmpty title="尚未创建分类" />}</section></div>;
}

function CategoryManagerRow({ category, count, profile, dragging, onDrag, onDrop, onSaved, onMessage }: { category: Category; count: number; profile: Profile; dragging: boolean; onDrag(): void; onDrop(): void; onSaved(): void; onMessage(value: string, error?: boolean): void }) {
  const [name, setName] = useState(category.name); const [description, setDescription] = useState(category.description); const [uploading, setUploading] = useState(false); const editable = canPublish(profile.role);
  const save = async (patch: Record<string, unknown>) => { const { error } = await supabase.from("categories").update({ ...patch, updated_by: profile.id }).eq("id", category.id); if (error) onMessage(error.message, true); else { onMessage("分类已保存。"); onSaved(); } };
  const upload = async (file: File) => { setUploading(true); try { const prepared = await imageToWebp(file); const path = cosStorageEnabled ? `site/categories/${category.id}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}` : `categories/${category.id}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; const stored = await uploadManagedFile({ file: prepared, path, purpose: "site-asset", visibility: "public" }); await save({ image_path: stored.path, image_provider: stored.provider }); } catch (error) { onMessage(messageOf(error, "封面上传失败"), true); } finally { setUploading(false); } };
  const remove = async () => { if (count > 0) return onMessage("请先移动或删除分类中的资料。", true); if (!window.confirm(`确定删除空分类“${category.name}”吗？`)) return; const { error } = await supabase.from("categories").delete().eq("id", category.id); if (error) onMessage(error.message, true); else { onMessage("分类已删除。"); onSaved(); } };
  return <article className={`category-manager-row${dragging ? " dragging" : ""}`} draggable={editable} onDragStart={onDrag} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}><div className="category-manager-cover">{category.imageUrl ? <img src={category.imageUrl} alt="" /> : <FolderOpen />}</div><div className="category-manager-fields"><input disabled={!editable} value={name} onChange={(event) => setName(event.target.value)} /><textarea disabled={!editable} value={description} onChange={(event) => setDescription(event.target.value)} /></div><div className="category-manager-meta"><strong>{count}</strong><span>篇资料</span><small>拖动排序</small></div>{editable && <div className="category-manager-actions"><label className="button quiet"><ImagePlus />{uploading ? "上传中" : "替换封面"}<input type="file" accept="image/*" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /></label><button className={`status ${category.visible ? "published" : "hidden"}`} onClick={() => save({ is_visible: !category.visible })}>{category.visible ? "显示" : "隐藏"}</button><button className="icon-only" onClick={() => save({ name: name.trim(), slug: slugify(name), description })}><Save /></button>{profile.role === "super_admin" && <button className="icon-only danger" onClick={remove}><Trash2 /></button>}</div>}</article>;
}
