import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { Outlet, Route, Routes, useLocation } from "react-router-dom";
import { DataProvider } from "./data";
import { fallbackPublicData, loadPublicHome, readPublicHomeCache } from "./lib/repository";
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
  const location = useLocation();
  const publicRoute = !location.pathname.startsWith("/admin");
  const site = useQuery({ queryKey: ["public-home"], queryFn: loadPublicHome, enabled: publicRoute, staleTime: 5 * 60_000, retry: 1, placeholderData: () => readPublicHomeCache() || fallbackPublicData });
  const data = site.error
    ? { ...(site.data || fallbackPublicData), loading: false, errorMessage: site.error instanceof Error ? site.error.message : "资料库暂时无法读取" }
    : site.data || fallbackPublicData;
  return <DataProvider data={data}><Suspense fallback={<div className="boot-state"><LoaderCircle className="spin" /><strong>正在加载管理模块</strong></div>}><Routes>
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
