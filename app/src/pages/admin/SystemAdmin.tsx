import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArrowRight, CalendarDays, CheckCircle2, Eye, FileClock, ImagePlus, LoaderCircle, Mail, Plus, RotateCcw,
  Save, Search, Settings, ShieldCheck, Trash2, Upload, UserPlus, Users, X
} from "lucide-react";
import { publicMediaBucket } from "../../lib/config";
import { randomId } from "../../lib/id";
import { getDocumentImportStatus, listDocumentImports } from "../../lib/repository";
import { sanitizeHtml } from "../../lib/sanitize";
import { supabase } from "../../lib/supabase";
import { imageToWebp, uploadWithProgress } from "../../lib/uploads";
import type { AppRole, Profile } from "../../types";
import { AdminEmpty, AdminLoading, AdminToast, formatBytes, formatDate, messageOf, publicAssetUrl, roleText } from "./shared";
import { CarouselSettings } from "./CarouselSettings";

export function UsersPage({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: profile.role === "super_admin"
  });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");
  const [message, setMessage] = useState("");
  const [errorState, setErrorState] = useState(false);
  const [inviting, setInviting] = useState(false);

  if (profile.role !== "super_admin") {
    return <div className="admin-error"><ShieldCheck /><h1>权限受限</h1><p>只有超级管理员可以邀请和修改后台账号。</p></div>;
  }

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setInviting(true);
    const { data, error } = await supabase.functions.invoke("invite-admin", { body: { email, displayName, role } });
    setInviting(false);
    if (error || data?.error) {
      setMessage(error?.message || data.error);
      setErrorState(true);
      return;
    }
    setMessage("邀请邮件已发送。");
    setErrorState(false);
    setEmail("");
    setDisplayName("");
    client.invalidateQueries({ queryKey: ["profiles"] });
  };

  return (
    <div className="admin-page-stack">
      <AdminToast message={message} error={errorState} onClose={() => setMessage("")} />
      <header className="admin-page-heading">
        <div><span>ACCESS CONTROL</span><h1>账号与权限</h1><p>邀请管理员，控制角色和账号状态。</p></div>
        <button className="button primary" type="button" onClick={() => document.getElementById("invite-form")?.scrollIntoView({ behavior: "smooth" })}><UserPlus />邀请账号</button>
      </header>
      <section className="admin-panel flush">
        <div className="user-table">
          <div className="user-table-head"><span>账号</span><span>角色</span><span>状态</span><span>创建时间</span><span>操作</span></div>
          {users.isLoading && <AdminLoading />}
          {users.data?.map((row) => (
            <div className="user-table-row" key={row.id}>
              <span className="user-avatar">{String(row.display_name || row.email).slice(0, 1).toUpperCase()}</span>
              <div><strong>{String(row.display_name || "未命名管理员")}</strong><small>{String(row.email)}{row.id === profile.id ? " · 当前账号" : ""}</small></div>
              <span>{roleText[row.role as AppRole]}</span>
              <span className={`account-status ${row.status}`}>{row.status === "active" ? "已启用" : row.status === "disabled" ? "已停用" : "待接受"}</span>
              <time>{formatDate(row.created_at)}</time>
              <button className="button quiet" onClick={() => setSelected(row)}>管理<ArrowRight /></button>
            </div>
          ))}
          {!users.data?.length && !users.isLoading && <AdminEmpty icon={<Users />} title="暂无后台账号" />}
        </div>
      </section>
      <section className="admin-panel invite-panel" id="invite-form">
        <div className="panel-heading"><div><h2>邀请新管理员</h2><p>对方通过邮件设置密码后才能登录。</p></div><Mail /></div>
        <form className="invite-form" onSubmit={invite}>
          <label>邮箱<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="管理员名称" /></label>
          <label>初始角色<select value={role} onChange={(event) => setRole(event.target.value as AppRole)}>{Object.entries(roleText).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button className="button primary" disabled={inviting}>{inviting ? <LoaderCircle className="spin" /> : <UserPlus />}发送邀请</button>
        </form>
      </section>
      {selected && <UserDrawer row={selected} currentUserId={profile.id} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); setMessage("账号设置已更新。"); setErrorState(false); client.invalidateQueries({ queryKey: ["profiles"] }); }} onError={(value) => { setMessage(value); setErrorState(true); }} />}
    </div>
  );
}

function UserDrawer({
  row,
  currentUserId,
  onClose,
  onSaved,
  onError
}: {
  row: Record<string, unknown>;
  currentUserId: string;
  onClose(): void;
  onSaved(): void;
  onError(value: string): void;
}) {
  const [displayName, setDisplayName] = useState(String(row.display_name || ""));
  const [role, setRole] = useState<AppRole>(row.role as AppRole);
  const [status, setStatus] = useState(String(row.status || "active"));
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if ((role !== row.role || status !== row.status) && !window.confirm("权限或账号状态将发生变化，确定保存吗？")) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("update-admin", { body: { userId: row.id, displayName, role, status, password } });
    setSaving(false);
    if (error || data?.error) onError(error?.message || data.error);
    else onSaved();
  };

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true">
      <aside className="user-drawer">
        <header><div><span>ADMIN ACCOUNT</span><h2>管理账号</h2></div><button className="icon-only" onClick={onClose}><X /></button></header>
        <div className="user-drawer-body">
          <div className="account-summary">
            <span className="user-avatar large">{String(displayName || row.email).slice(0, 1).toUpperCase()}</span>
            <div><strong>{displayName || "未命名管理员"}</strong><span>{String(row.email)}{row.id === currentUserId ? " · 当前账号" : ""}</span></div>
          </div>
          <label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label>角色<select value={role} onChange={(event) => setRole(event.target.value as AppRole)}><option value="super_admin">超级管理员</option><option value="editor">内容管理员</option><option value="uploader">上传管理员</option><option value="viewer">只读管理员</option></select></label>
          <label>账号状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">启用</option><option value="disabled">停用</option><option value="invited">待接受邀请</option></select></label>
          <div className="drawer-divider" />
          <label>设置新密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="留空则不修改" /></label>
          <p className="field-help">密码不会显示或保存在后台页面中。</p>
        </div>
        <footer><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" /> : <Save />}保存账号</button></footer>
      </aside>
    </div>
  );
}

export function HistoryPage({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const [tab, setTab] = useState<"revisions" | "audit" | "updates" | "runtime" | "imports">("audit");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [date, setDate] = useState("");
  const [revision, setRevision] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const [errorState, setErrorState] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState("");

  const logs = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: profile.role !== "uploader" && tab === "audit"
  });
  const updates = useQuery({
    queryKey: ["release-notes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("release_notes").select("*").order("released_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: profile.role !== "uploader" && tab === "updates"
  });
  const runtime = useQuery({
    queryKey: ["runtime-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("runtime_logs").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: profile.role !== "uploader" && tab === "runtime"
  });
  const revisions = useQuery({
    queryKey: ["content-revisions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("content_revisions").select("id, content_id, version, snapshot, created_at, created_by, contents(title, version)").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: profile.role !== "uploader" && tab === "revisions"
  });
  const documentImports = useQuery({
    queryKey: ["document-imports"],
    queryFn: listDocumentImports,
    enabled: profile.role !== "uploader" && tab === "imports"
  });
  const documentImportStatus = useQuery({
    queryKey: ["document-import-status", selectedImportId],
    queryFn: () => getDocumentImportStatus(selectedImportId),
    enabled: Boolean(selectedImportId) && profile.role !== "uploader",
    refetchInterval: (query) => query.state.data?.job.status === "uploading" ? 5_000 : false
  });
  const visibleLogs = useMemo(
    () => (logs.data || []).filter((row) => (action === "all" || String(row.action).toUpperCase() === action) && (!date || String(row.created_at).startsWith(date)) && (!query || `${row.action} ${row.entity_type} ${row.entity_id} ${JSON.stringify(row.metadata || {})}`.toLowerCase().includes(query.toLowerCase()))),
    [logs.data, action, date, query]
  );
  const visibleRuntime = useMemo(
    () => (runtime.data || []).filter((row) => (!date || String(row.created_at).startsWith(date)) && (!query || `${row.source} ${row.message} ${row.route}`.toLowerCase().includes(query.toLowerCase()))),
    [runtime.data, date, query]
  );

  const restore = async (row: Record<string, unknown>) => {
    if (!window.confirm("恢复后会生成新的草稿版本，确定继续吗？")) return;
    const content = row.contents as { version: number } | null;
    const { data, error } = await supabase.functions.invoke("restore-revision", { body: { revisionId: row.id, version: content?.version } });
    if (error || data?.error) {
      setMessage(error?.message || data.error);
      setErrorState(true);
      return;
    }
    setMessage("历史版本已恢复为草稿。");
    setErrorState(false);
    setRevision(null);
    client.invalidateQueries({ queryKey: ["content-revisions"] });
    client.invalidateQueries({ queryKey: ["admin-contents"] });
  };

  const resolveRuntime = async (id: number) => {
    const { error } = await supabase.from("runtime_logs").update({ resolved_at: new Date().toISOString(), resolved_by: profile.id }).eq("id", id);
    if (error) return;
    client.invalidateQueries({ queryKey: ["runtime-logs"] });
  };

  if (profile.role === "uploader") return <div className="admin-error"><ShieldCheck /><h1>权限受限</h1><p>上传管理员不能查看全站操作日志和历史版本。</p></div>;

  return (
    <div className="admin-page-stack">
      <AdminToast message={message} error={errorState} onClose={() => setMessage("")} />
      <header className="admin-page-heading"><div><span>REVISION & AUDIT</span><h1>日志中心</h1><p>查看内容版本、后台变更、版本更新和运行错误。</p></div></header>
      <div className="history-tabs"><button className={tab === "revisions" ? "active" : ""} onClick={() => setTab("revisions")}><FileClock />内容版本</button><button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><Activity />操作日志</button><button className={tab === "updates" ? "active" : ""} onClick={() => setTab("updates")}><RotateCcw />更新日志</button><button className={tab === "runtime" ? "active" : ""} onClick={() => setTab("runtime")}><ShieldCheck />运行日志</button><button className={tab === "imports" ? "active" : ""} onClick={() => setTab("imports")}><Upload />文档导入</button></div>
      {(tab === "audit" || tab === "runtime") && <div className="history-filters"><label className="search-control"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "audit" ? "搜索操作、记录 ID 或文件信息" : "搜索错误来源、消息或页面"} /></label>{tab === "audit" && <select value={action} onChange={(event) => setAction(event.target.value)}><option value="all">全部操作</option><option value="INSERT">新增</option><option value="UPDATE">更新</option><option value="DELETE">删除</option></select>}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>}
      {tab === "revisions" && <section className="admin-panel"><div className="panel-heading"><div><h2>内容版本</h2><p>最近 100 个历史版本</p></div><FileClock /></div><div className="revision-list">{revisions.data?.map((row) => { const content = row.contents as unknown as { title: string; version: number } | null; return <button key={row.id} onClick={() => setRevision(row)}><RotateCcw /><div><strong>{content?.title || row.content_id}</strong><span>历史 v{row.version} · 当前 v{content?.version || "-"}</span></div><time>{formatDate(row.created_at)}</time><Eye /></button>; })}{!revisions.data?.length && <AdminEmpty title="暂无历史版本" />}</div></section>}
      {tab === "audit" && <section className="admin-panel"><div className="panel-heading"><div><h2>操作日志</h2><p>记录资料、媒体、账号和设置的变更。</p></div><Activity /></div><div className="audit-list detailed-audit-list">{visibleLogs.map((log) => <details key={log.id}><summary><span className="activity-dot" /><div><strong>{auditText(String(log.action))} · {String(log.entity_type)}</strong><span>{String((log.metadata as Record<string, unknown>)?.title || log.entity_id)}</span></div><time>{formatDate(log.created_at)}</time></summary><div className="audit-detail"><span>记录 ID：{String(log.entity_id)}</span><span>字段：{String(((log.metadata as Record<string, unknown>)?.changed_fields as string[] || []).join("、") || "新增或删除")}</span><span>媒体：{String((log.metadata as Record<string, unknown>)?.kind || "-")} · {String((log.metadata as Record<string, unknown>)?.mime_type || "-")} · {formatBytes(Number((log.metadata as Record<string, unknown>)?.size_bytes || 0))}</span></div></details>)}{!visibleLogs.length && <AdminEmpty title="没有符合条件的日志" />}</div></section>}
      {tab === "updates" && <ReleaseNotesPanel profile={profile} rows={updates.data || []} onSaved={() => client.invalidateQueries({ queryKey: ["release-notes"] })} />}
      {tab === "imports" && <section className="admin-panel"><div className="panel-heading"><div><h2>文档导入</h2><p>逐图解析、TUS 上传、服务端登记和提交记录。</p></div><Upload /></div><div className="runtime-log-list">{documentImports.data?.jobs.map((job) => <details key={job.id} open={selectedImportId === job.id}><summary onClick={() => setSelectedImportId(job.id)}><span className={`runtime-severity ${job.status === "failed" ? "error" : job.status === "uploading" ? "warning" : "info"}`} /><div><strong>{job.source_file_name || "Word 导入"} · {job.status}</strong><span>{job.expected_images} 张图片 · {formatBytes(Number(job.total_original_bytes || 0))}</span></div><time>{formatDate(job.created_at)}</time></summary>{selectedImportId === job.id && <div className="audit-detail"><span>任务 ID：{job.id}</span><span>已登记：{documentImportStatus.data?.assets.length ?? "-"}/{job.expected_images}</span>{job.error_message && <span>错误：{job.error_message}</span>}<div className="runtime-log-list">{documentImportStatus.data?.events.map((event) => <details key={event.id}><summary><span className={`runtime-severity ${event.severity}`} /><div><strong>图片 {event.image_index || "-"} · {event.phase}</strong><span>{event.message}</span></div><time>{formatDate(event.created_at)}</time></summary><div className="audit-detail"><span>上传：{formatBytes(Number(event.bytes_uploaded || 0))}/{formatBytes(Number(event.bytes_total || 0))}</span><span>重试：{event.retry_count || 0}{event.http_status ? ` · HTTP ${event.http_status}` : ""}{event.error_code ? ` · ${event.error_code}` : ""}</span>{event.details && Object.keys(event.details).length > 0 && <pre>{JSON.stringify(event.details, null, 2)}</pre>}</div></details>)}{documentImportStatus.isLoading && <AdminLoading label="正在读取逐图导入日志" />}</div></div>}</details>)}{!documentImports.data?.jobs.length && <AdminEmpty title="暂无文档导入任务" />}</div></section>}
      {tab === "runtime" && <section className="admin-panel"><div className="panel-heading"><div><h2>运行日志</h2><p>导入、上传、播放器和前端异常。</p></div><ShieldCheck /></div><div className="runtime-log-list">{visibleRuntime.map((log) => <details className={log.resolved_at ? "resolved" : ""} key={log.id}><summary><span className={`runtime-severity ${log.severity}`} /><div><strong>{String(log.source)} · {String(log.message)}</strong><span>{String(log.route || "-")}</span></div><time>{formatDate(log.created_at)}</time></summary><div className="audit-detail"><span>版本：{String(log.app_version || "-")}</span><span>状态：{log.resolved_at ? `已处理 · ${formatDate(log.resolved_at)}` : "未处理"}</span>{log.context && Object.keys(log.context as Record<string, unknown>).length > 0 && <pre>{JSON.stringify(log.context, null, 2)}</pre>}{log.stack && <pre>{String(log.stack)}</pre>}{profile.role === "super_admin" && !log.resolved_at && <button className="button quiet" onClick={() => resolveRuntime(Number(log.id))}><CheckCircle2 />标记已处理</button>}</div></details>)}{!visibleRuntime.length && <AdminEmpty title="暂无运行错误" />}</div></section>}
      {revision && <RevisionDrawer row={revision} canRestore={profile.role === "super_admin" || profile.role === "editor"} onRestore={() => restore(revision)} onClose={() => setRevision(null)} />}
    </div>
  );
}

function auditText(action: string) {
  const normalized = action.toUpperCase();
  return ({ INSERT: "新增", UPDATE: "修改", DELETE: "删除" } as Record<string, string>)[normalized] || action;
}

function ReleaseNotesPanel({ profile, rows, onSaved }: { profile: Profile; rows: Array<Record<string, unknown>>; onSaved(): void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [features, setFeatures] = useState("");
  const [fixes, setFixes] = useState("");
  const [optimizations, setOptimizations] = useState("");
  const list = (value: string) => value.split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    const { error } = await supabase.from("release_notes").insert({ version: version.trim(), title: title.trim(), summary, details, features: list(features), fixes: list(fixes), optimizations: list(optimizations), created_by: profile.id, updated_by: profile.id });
    setSaving(false);
    if (error) return;
    setVersion(""); setTitle(""); setSummary(""); setDetails(""); setFeatures(""); setFixes(""); setOptimizations(""); setOpen(false); onSaved();
  };
  const remove = async (id: string) => {
    if (!window.confirm("确定删除这条更新日志吗？")) return;
    const { error } = await supabase.from("release_notes").delete().eq("id", id);
    if (!error) onSaved();
  };
  return <section className="admin-panel release-notes-panel">
    <div className="panel-heading"><div><h2>更新日志</h2><p>记录网站功能、修复和优化内容。</p></div>{profile.role === "super_admin" && <button className="button primary" onClick={() => setOpen((value) => !value)}><Plus />新增更新</button>}</div>
    {open && <form className="release-note-form" onSubmit={create}><label>版本号<input required value={version} onChange={(event) => setVersion(event.target.value)} placeholder="2.1.0" /></label><label>标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="wide">摘要<textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label className="wide">详细说明<textarea value={details} onChange={(event) => setDetails(event.target.value)} /></label><label>新增功能<textarea value={features} onChange={(event) => setFeatures(event.target.value)} placeholder="每行一项" /></label><label>修复内容<textarea value={fixes} onChange={(event) => setFixes(event.target.value)} placeholder="每行一项" /></label><label>优化内容<textarea value={optimizations} onChange={(event) => setOptimizations(event.target.value)} placeholder="每行一项" /></label><button className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />}保存更新日志</button></form>}
    <div className="release-note-list">{rows.map((row) => <article key={String(row.id)}><header><span>V{String(row.version)}</span><div><h3>{String(row.title)}</h3><p>{String(row.summary || "")}</p></div><time><CalendarDays />{formatDate(String(row.released_at))}</time>{profile.role === "super_admin" && <button className="icon-only danger" onClick={() => remove(String(row.id))}><Trash2 /></button>}</header>{Boolean(row.details) && <p>{String(row.details)}</p>}<div className="release-note-columns"><ReleaseItems title="新增" items={row.features} /><ReleaseItems title="修复" items={row.fixes} /><ReleaseItems title="优化" items={row.optimizations} /></div></article>)}{!rows.length && <AdminEmpty title="暂无更新日志" />}</div>
  </section>;
}

function ReleaseItems({ title, items }: { title: string; items: unknown }) {
  const list = Array.isArray(items) ? items.map(String) : [];
  if (!list.length) return null;
  return <div><strong>{title}</strong>{list.map((item) => <span key={item}>{item}</span>)}</div>;
}

function RevisionDrawer({ row, canRestore, onRestore, onClose }: { row: Record<string, unknown>; canRestore: boolean; onRestore(): void; onClose(): void }) {
  const snapshot = row.snapshot as Record<string, unknown>;
  const content = row.contents as { title?: string } | null;
  return (
    <div className="drawer-backdrop">
      <aside className="user-drawer revision-drawer">
        <header><div><span>VERSION {String(row.version)}</span><h2>{content?.title || "历史版本"}</h2></div><button className="icon-only" onClick={onClose}><X /></button></header>
        <div className="user-drawer-body">
          <dl className="revision-summary">
            <div><dt>标题</dt><dd>{String(snapshot.title || "-")}</dd></div>
            <div><dt>状态</dt><dd>{String(snapshot.status || "-")}</dd></div>
            <div><dt>简介</dt><dd>{String(snapshot.summary || "-")}</dd></div>
            <div><dt>记录时间</dt><dd>{formatDate(String(row.created_at))}</dd></div>
          </dl>
          <div className="revision-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(snapshot.body_html || "<p>无正文</p>")) }} />
        </div>
        <footer><button className="button quiet" onClick={onClose}>关闭</button>{canRestore && <button className="button primary" onClick={onRestore}><RotateCcw />恢复为草稿</button>}</footer>
      </aside>
    </div>
  );
}

export function SettingsPage({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_settings").select("*").eq("id", "main").single();
      if (error) throw error;
      return data;
    }
  });
  const [tab, setTab] = useState<"text" | "assets" | "carousel" | "preview">("text");
  const [message, setMessage] = useState("");
  const [errorState, setErrorState] = useState(false);

  if (profile.role !== "super_admin") return <div className="admin-error"><ShieldCheck /><h1>权限受限</h1><p>只有超级管理员可以修改首页设置。</p></div>;
  if (settings.error) return <div className="admin-error"><Settings /><h1>首页设置读取失败</h1><p>{messageOf(settings.error)}</p></div>;
  if (!settings.data) return <AdminLoading label="正在读取首页设置" />;

  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["admin-settings"] }),
      client.invalidateQueries({ queryKey: ["public-home"] }),
      client.invalidateQueries({ queryKey: ["preview-carousel-slides"] })
    ]);
  };
  const notify = (value: string, error = false) => {
    setMessage(value);
    setErrorState(error);
  };
  const saveText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from("site_settings").update({
      brand_title: form.get("brandTitle"),
      brand_subtitle: form.get("brandSubtitle"),
      hero_title: form.get("heroTitle"),
      hero_subtitle: form.get("heroSubtitle"),
      category_title: form.get("categoryTitle"),
      category_subtitle: form.get("categorySubtitle"),
      updated_by: profile.id
    }).eq("id", "main");
    if (error) notify(error.message, true);
    else {
      notify("站点文字已保存。");
      refresh();
    }
  };

  const assets: Array<[string, string, string]> = [
    ["top_logo_path", "顶部 Logo", "显示在网站导航栏"],
    ["hero_logo_path", "首页 Logo", "显示在首页标题上方"],
    ["page_background_path", "全站背景", "连续覆盖主视觉、类目与页脚"],
    ["tile_background_path", "类目默认背景", "类目未单独上传封面时使用"]
  ];

  return (
    <div className="admin-page-stack">
      <AdminToast message={message} error={errorState} onClose={() => setMessage("")} />
      <header className="admin-page-heading"><div><span>SITE APPEARANCE</span><h1>首页与品牌设置</h1><p>集中管理站点文字、Logo、背景和轮播。</p></div></header>
      <div className="settings-tabs">
        <button className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}><Settings />品牌文字</button>
        <button className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}><ImagePlus />图片与背景</button>
        <button className={tab === "carousel" ? "active" : ""} onClick={() => setTab("carousel")}><RotateCcw />轮播图</button>
        <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}><Eye />实时预览</button>
      </div>
      {tab === "text" && (
        <section className="admin-panel settings-section">
          <div className="panel-heading"><div><h2>站点文字</h2><p>保存后立即同步到前台。</p></div></div>
          <form className="settings-form" onSubmit={saveText}>
            <label>站点名称<input name="brandTitle" defaultValue={settings.data.brand_title} /></label>
            <label>顶部副标题<input name="brandSubtitle" defaultValue={settings.data.brand_subtitle} /></label>
            <label>首页标题<input name="heroTitle" defaultValue={settings.data.hero_title} /></label>
            <label>首页说明<textarea name="heroSubtitle" defaultValue={settings.data.hero_subtitle} /></label>
            <label>类目区标题<input name="categoryTitle" defaultValue={settings.data.category_title} /></label>
            <label>类目区说明<textarea name="categorySubtitle" defaultValue={settings.data.category_subtitle} /></label>
            <button className="button primary"><Save />保存文字</button>
          </form>
        </section>
      )}
      {tab === "assets" && (
        <section className="admin-panel settings-section">
          <div className="panel-heading"><div><h2>界面图片</h2><p>支持上传、替换和清除，不再提供内置素材。</p></div></div>
          <div className="setting-assets">
            {assets.map(([field, label, detail]) => <SettingAsset key={field} field={field} label={label} detail={detail} current={String(settings.data[field] || "")} userId={profile.id} onSaved={() => { notify(`${label}已更新。`); refresh(); }} onMessage={notify} />)}
          </div>
        </section>
      )}
      {tab === "carousel" && <CarouselSettings profile={profile} settings={settings.data} onMessage={notify} onSaved={refresh} />}
      {tab === "preview" && <SiteMiniPreview settings={settings.data} onOpenCarousel={() => setTab("carousel")} />}
    </div>
  );
}

function SettingAsset({
  field,
  label,
  detail,
  current,
  userId,
  onSaved,
  onMessage
}: {
  field: string;
  label: string;
  detail: string;
  current: string;
  userId: string;
  onSaved(): void;
  onMessage(value: string, error?: boolean): void;
}) {
  const [progress, setProgress] = useState(0);
  const preview = current ? publicAssetUrl(current) : "";

  const upload = async (file: File) => {
    try {
      if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
      const prepared = await imageToWebp(file);
      const path = `settings/${field}/${randomId()}-${prepared.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
      await uploadWithProgress(prepared, path, (value) => setProgress(value.percent), undefined, publicMediaBucket);
      const { error } = await supabase.from("site_settings").update({ [field]: path, updated_by: userId }).eq("id", "main");
      if (error) throw error;
      await onSaved();
    } catch (error) {
      onMessage(messageOf(error, "图片上传失败"), true);
    } finally {
      setProgress(0);
    }
  };

  const clear = async () => {
    if (!window.confirm(`确定清除${label}吗？`)) return;
    const { error } = await supabase.from("site_settings").update({ [field]: null, updated_by: userId }).eq("id", "main");
    if (error) onMessage(error.message, true);
    else onSaved();
  };

  return (
    <article className="setting-asset-row">
      {preview ? <img src={preview} alt="" /> : <span><ImagePlus /></span>}
      <div><strong>{label}</strong><p>{detail}</p><small>{current || "尚未设置"}</small></div>
      {progress > 0 ? <div className="asset-upload-progress"><span style={{ width: `${progress}%` }} /><strong>{progress}%</strong></div> : <div className="setting-asset-actions"><label className="button quiet upload-button"><Upload />替换<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} /></label>{current && <button className="icon-only danger" onClick={clear}><Trash2 /></button>}</div>}
    </article>
  );
}

type PreviewCarouselRow = {
  id: string;
  title: string;
  subtitle: string;
  image_path: string | null;
  link_label: string;
  sort_order: number;
  is_visible: boolean;
};

export function SiteMiniPreview({ settings, onOpenCarousel }: { settings: Record<string, unknown>; onOpenCarousel?: () => void }) {
  const background = publicAssetUrl(String(settings.page_background_path || ""));
  const logo = publicAssetUrl(String(settings.top_logo_path || ""));
  const slides = useQuery({
    queryKey: ["preview-carousel-slides"],
    queryFn: async () => {
      const { data, error } = await supabase.from("carousel_slides").select("id,title,subtitle,image_path,link_label,sort_order,is_visible").order("sort_order");
      if (error) throw error;
      return (data || []) as PreviewCarouselRow[];
    }
  });
  const visibleSlides = (slides.data || []).filter((slide) => slide.is_visible);
  const slide = visibleSlides[0];
  const slideImage = slide?.image_path ? publicAssetUrl(slide.image_path) : "";
  return (
    <section className="site-mini-preview" style={background ? { backgroundImage: `linear-gradient(rgba(8,13,16,.72), rgba(8,13,16,.86)), url(${background})` } : undefined}>
      <header>{logo ? <img src={logo} alt="" /> : <span>NK</span>}<div><strong>{String(settings.brand_title)}</strong><small>{String(settings.brand_subtitle)}</small></div></header>
      <main>
        <span>MAPLESTORYNK KNOWLEDGE BASE</span>
        <h2>{String(settings.hero_title)}</h2>
        <p>{String(settings.hero_subtitle)}</p>
        <section className="mini-carousel-preview">
          <small>HOME CAROUSEL</small>
          <h3>轮播主视觉</h3>
          <p>预览当前启用的第一张轮播图、标题、说明和按钮效果。</p>
          {slides.isLoading ? <div className="mini-carousel-state">正在读取轮播图</div> : slides.error ? <div className="mini-carousel-state error">轮播图读取失败</div> : slide ? (
            <div className="mini-carousel-frame">
              {slideImage ? <img src={slideImage} alt="" /> : <i />}
              <div><strong>{slide.title || "未命名轮播"}</strong>{slide.subtitle && <p>{slide.subtitle}</p>}{slide.link_label && <em>{slide.link_label}</em>}</div>
              {visibleSlides.length > 1 && <nav>{visibleSlides.slice(0, 5).map((item, index) => <b className={index === 0 ? "active" : ""} key={item.id} />)}</nav>}
            </div>
          ) : <div className="mini-carousel-state empty"><strong>还没有轮播图</strong><span>去轮播图页新增图片、标题和说明。</span>{onOpenCarousel && <button className="button quiet" type="button" onClick={onOpenCarousel}>去新增轮播</button>}</div>}
        </section>
        <section><h3>{String(settings.category_title)}</h3><p>{String(settings.category_subtitle)}</p><div><i /><i /><i /><i /></div></section>
      </main>
    </section>
  );
}
