import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FolderOpen, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { publicMediaBucket } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import type { AppRole, Category, ContentItem, ContentStatus, Profile } from "../../types";

export const roleText: Record<AppRole, string> = {
  super_admin: "超级管理员", editor: "内容管理员", uploader: "上传管理员", viewer: "只读管理员"
};

export const statusText: Record<ContentStatus, string> = {
  draft: "草稿", published: "已发布", hidden: "隐藏", trashed: "回收站"
};

export function canEdit(role?: AppRole) { return role === "super_admin" || role === "editor" || role === "uploader"; }
export function canPublish(role?: AppRole) { return role === "super_admin" || role === "editor"; }
export function canEditItem(profile: Profile, item: ContentItem) {
  return profile.role === "super_admin" || profile.role === "editor" || (profile.role === "uploader" && item.status === "draft" && item.createdBy === profile.id);
}

export function messageOf(error: unknown, fallback = "操作失败") { return error instanceof Error ? error.message : fallback; }

export function publicAssetUrl(path?: string | null) {
  return path ? supabase.storage.from(publicMediaBucket).getPublicUrl(path).data.publicUrl : "";
}

export function useAdminCategories() {
  return useQuery({ queryKey: ["admin-categories"], queryFn: async () => {
    const { data, error } = await supabase.from("categories").select("*").order("sort_order");
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id, slug: row.slug, name: row.name, description: row.description || "",
      imageUrl: publicAssetUrl(row.image_path), sortOrder: row.sort_order, visible: row.is_visible
    })) as Category[];
  } });
}

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <span className={`status ${status}`}>{statusText[status]}</span>;
}

export function AdminPageHeader({ title, description, context, action }: {
  title: string;
  description?: string;
  context?: string;
  action?: React.ReactNode;
}) {
  return <header className="admin-page-heading"><div>{context && <span>{context}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}

export function AdminLoading({ label = "正在读取数据" }: { label?: string }) {
  return <div className="admin-loading"><LoaderCircle className="spin" /><span>{label}</span></div>;
}

export function AdminEmpty({ icon, title, detail }: { icon?: React.ReactNode; title: string; detail?: string }) {
  return <div className="admin-empty">{icon || <FolderOpen />}<strong>{title}</strong>{detail && <span>{detail}</span>}</div>;
}

export function AdminToast({ message, error, onClose }: { message: string; error?: boolean; onClose(): void }) {
  if (!message) return null;
  return <div className={`admin-toast${error ? " error" : ""}`} role="status">{error ? <TriangleAlert /> : <CheckCircle2 />}<span>{message}</span><button type="button" onClick={onClose} aria-label="关闭"><X /></button></div>;
}

export function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

export function formatBytes(value: number) {
  if (!value) return "0 MB";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
