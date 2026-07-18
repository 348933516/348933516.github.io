import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCcw } from "lucide-react";
import { Route, Routes } from "react-router-dom";
import { DataProvider } from "./data";
import { loadPublicData } from "./lib/repository";
import { SiteLayout } from "./components/SiteLayout";
import { CategoryPage, DetailPage, HomePage, NotFoundPage, SearchPage } from "./pages/PublicPages";

const AdminPage = lazy(() => import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));

export function App() {
  const site = useQuery({ queryKey: ["public-site"], queryFn: loadPublicData, staleTime: 60_000, retry: 1 });
  if (site.isLoading) return <div className="boot-state"><LoaderCircle className="spin" /><strong>正在读取资料库</strong><span>连接安全数据源...</span></div>;
  if (site.error || !site.data) return <div className="boot-state error"><RefreshCcw /><strong>资料库暂时无法读取</strong><span>{site.error instanceof Error ? site.error.message : "请稍后重试"}</span><button className="button primary" onClick={() => site.refetch()}>重新连接</button></div>;
  return <DataProvider data={site.data}><Routes><Route element={<SiteLayout><RoutesOutlet /></SiteLayout>} path="*" /></Routes></DataProvider>;
}

function RoutesOutlet() {
  return <Suspense fallback={<div className="boot-state"><LoaderCircle className="spin" /><strong>正在加载管理模块</strong></div>}><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/category/:slug" element={<CategoryPage />} />
    <Route path="/content/:slug" element={<DetailPage />} />
    <Route path="/search" element={<SearchPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/admin" element={<AdminPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></Suspense>;
}
