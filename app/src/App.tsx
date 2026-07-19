import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCcw } from "lucide-react";
import { Outlet, Route, Routes } from "react-router-dom";
import { DataProvider } from "./data";
import { loadPublicData } from "./lib/repository";
import { SiteLayout } from "./components/SiteLayout";
import { CategoryPage, DetailPage, HomePage, NotFoundPage } from "./pages/PublicPages";
import { installGlobalRuntimeLogging } from "./lib/runtimeLogs";

function lazyWithRefresh(loader: () => Promise<{ default: ComponentType }>, key: string) {
  return lazy(async () => {
    try {
      const module = await loader();
      sessionStorage.removeItem(key);
      return module;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/dynamically imported module|failed to fetch|imported module/i.test(message) && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
  });
}

const AdminPage = lazyWithRefresh(() => import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })), "maplestorynk-admin-chunk-retry");
const LoginPage = lazyWithRefresh(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })), "maplestorynk-login-chunk-retry");

export function App() {
  useEffect(() => installGlobalRuntimeLogging(), []);
  const site = useQuery({ queryKey: ["public-site"], queryFn: loadPublicData, staleTime: 60_000, retry: 1 });
  if (site.isLoading) return <div className="boot-state"><LoaderCircle className="spin" /><strong>正在读取资料库</strong><span>连接安全数据源...</span></div>;
  if (site.error || !site.data) return <div className="boot-state error"><RefreshCcw /><strong>资料库暂时无法读取</strong><span>{site.error instanceof Error ? site.error.message : "请稍后重试"}</span><button className="button primary" onClick={() => site.refetch()}>重新连接</button></div>;
  return <DataProvider data={site.data}><Suspense fallback={<div className="boot-state"><LoaderCircle className="spin" /><strong>正在加载管理模块</strong></div>}><Routes>
    <Route path="/admin/*" element={<AdminPage />} />
    <Route element={<SiteLayout><Outlet /></SiteLayout>}>
      <Route path="/" element={<HomePage />} />
      <Route path="/category/:slug" element={<CategoryPage />} />
      <Route path="/content/:slug" element={<DetailPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes></Suspense></DataProvider>;
}
