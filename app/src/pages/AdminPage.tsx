import { useState } from "react";
import {
  ArrowLeft, Database, FolderTree, Gauge, History, ImagePlus, LayoutDashboard,
  LogOut, Menu, Search, Settings, ShieldCheck, Users
} from "lucide-react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import {
  CategoriesPage, ContentEditorPage, ContentListPage, DashboardPage, MediaLibraryPage, NewContentPage
} from "./admin/ContentAdmin";
import { HistoryPage, SettingsPage, UsersPage } from "./admin/SystemAdmin";
import { AdminLoading, canEdit, roleText } from "./admin/shared";

const navGroups = [
  { label: "内容", items: [
    ["/admin/overview", "概览", Gauge], ["/admin/contents", "内容管理", Database],
    ["/admin/categories", "分类管理", FolderTree], ["/admin/media", "媒体与附件", ImagePlus]
  ] },
  { label: "系统", items: [
    ["/admin/users", "账号权限", Users], ["/admin/history", "版本与日志", History],
    ["/admin/settings", "首页设置", Settings]
  ] }
] as const;

const pageNames: Record<string, string> = {
  overview: "内容概览", contents: "内容管理", categories: "分类管理", media: "媒体与附件",
  users: "账号权限", history: "版本与日志", settings: "首页设置", new: "新建资料"
};

export function AdminPage() {
  const { user, profile, loading, profileError, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <AdminLoading label="正在验证管理员权限" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile || profile.status !== "active") return <div className="admin-gate"><ShieldCheck /><h1>尚未获得后台权限</h1><p>{profileError || "请让超级管理员邀请或启用这个账号。"}</p><Link className="button quiet" to="/"><ArrowLeft />返回网站</Link></div>;
  const editorMode = /^\/admin\/contents\/[^/]+$/.test(location.pathname) && !location.pathname.endsWith("/new");
  if (editorMode) return canEdit(profile.role) ? <div className="admin-editor-shell"><Routes><Route path="contents/:id" element={<ContentEditorPage profile={profile} />} /><Route path="*" element={<Navigate to="/admin/contents" replace />} /></Routes></div> : <Navigate to="/admin/contents" replace />;
  return <AdminLayout profileName={profile.displayName} role={roleText[profile.role]} signOut={signOut}><Routes>
    <Route index element={<Navigate to="overview" replace />} />
    <Route path="overview" element={<DashboardPage profile={profile} />} />
    <Route path="contents" element={<ContentListPage profile={profile} />} />
    <Route path="contents/new" element={canEdit(profile.role) ? <NewContentPage profile={profile} /> : <Navigate to="/admin/contents" replace />} />
    <Route path="categories" element={<CategoriesPage profile={profile} />} />
    <Route path="media" element={<MediaLibraryPage profile={profile} />} />
    <Route path="users" element={<UsersPage profile={profile} />} />
    <Route path="history" element={<HistoryPage profile={profile} />} />
    <Route path="settings" element={<SettingsPage profile={profile} />} />
    <Route path="*" element={<Navigate to="overview" replace />} />
  </Routes></AdminLayout>;
}

function AdminLayout({ profileName, role, signOut, children }: { profileName: string; role: string; signOut(): Promise<void>; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false); const [query, setQuery] = useState(""); const navigate = useNavigate(); const location = useLocation();
  const segment = location.pathname.split("/").filter(Boolean).at(-1) || "overview";
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (query.trim()) navigate(`/admin/contents?q=${encodeURIComponent(query.trim())}`); };
  return <div className="admin-shell"><aside className={`admin-sidebar${menuOpen ? " open" : ""}`}><Link className="admin-brand" to="/admin/overview"><span>NK</span><div><strong>MapleStoryNK</strong><small>内容管理中心</small></div></Link><nav>{navGroups.map((group) => <div className="admin-nav-group" key={group.label}><span>{group.label}</span>{group.items.map(([path, label, Icon]) => <NavLink key={path} to={path} className={({ isActive }) => isActive ? "active" : ""} onClick={() => setMenuOpen(false)}><Icon />{label}</NavLink>)}</div>)}</nav><div className="admin-account"><div className="user-avatar">{profileName.slice(0, 1).toUpperCase()}</div><div><span>{profileName}</span><small>{role}</small></div><button title="退出后台" type="button" onClick={() => signOut()}><LogOut /></button></div></aside>
    {menuOpen && <button className="admin-menu-backdrop" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}
    <main className="admin-main"><header className="admin-top"><button className="icon-only mobile-menu" onClick={() => setMenuOpen(true)}><Menu /></button><div className="admin-breadcrumb"><LayoutDashboard /><span>管理后台</span><b>/</b><strong>{pageNames[segment] || "工作台"}</strong></div><form className="admin-global-search" onSubmit={submit}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索后台资料" /></form><Link className="button quiet" to="/"><ArrowLeft />返回前台</Link></header><div className="admin-content">{children}</div></main>
  </div>;
}
