import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, LayoutDashboard, LogIn, LogOut, Search, UserRound } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useSiteData } from "../data";

export function SiteLayout({ children }: { children: ReactNode }) {
  const { settings, backendMode } = useSiteData();
  const { user, profile, signOut } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [query, setQuery] = useState("");
  const accountRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setAccountOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (value) navigate(`/search?q=${encodeURIComponent(value)}`);
  };

  return (
    <div className="site-shell" style={settings.pageBackgroundUrl ? { backgroundImage: `linear-gradient(rgba(8,13,16,.88), rgba(8,13,16,.95)), url(${settings.pageBackgroundUrl})` } : undefined}>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand-link" to="/">
            <span className="brand-logo">{settings.topLogoUrl ? <img src={settings.topLogoUrl} alt="" /> : "NK"}</span>
            <span><strong>{settings.brandTitle}</strong><small>{settings.brandSubtitle}</small></span>
          </Link>
          <form className="header-search" onSubmit={submitSearch}>
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文、图片标注或标签" aria-label="全站搜索" />
          </form>
          <div className="account-control" ref={accountRef}>
            {user ? (
              <>
                <button className="button quiet account-button" type="button" onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen}>
                  <UserRound /><span>{profile?.displayName || user.email}</span><ChevronDown />
                </button>
                {accountOpen && (
                  <div className="account-popover">
                    <div className="account-identity"><strong>{profile?.displayName || "管理员"}</strong><span>{user.email}</span></div>
                    {profile && <Link to="/admin"><LayoutDashboard />管理后台</Link>}
                    <button type="button" onClick={() => signOut()}><LogOut />退出登录</button>
                  </div>
                )}
              </>
            ) : <Link className="button quiet" to="/login"><LogIn />管理员登录</Link>}
          </div>
        </div>
      </header>
      {backendMode === "legacy" && <div className="preview-banner"><BookOpen />新版预览正在读取旧站数据；执行数据库迁移后会自动启用正式后台。</div>}
      <main>{children}</main>
      <footer className="site-footer"><span>{settings.brandTitle}</span><span>资料百科 · 内容由管理员维护</span></footer>
    </div>
  );
}
