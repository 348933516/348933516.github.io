import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, LoaderCircle, LogIn, LogOut, Mail, RefreshCw, ShieldAlert } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { supabase } from "../lib/supabase";
import "../styles/admin.css";

const rememberedEmailKey = "maplestorynk.admin.email";

export function LoginPage() {
  const { user, profile, profileError, loading: authLoading, signIn, signOut, refreshProfile } = useAuth();
  const [email, setEmail] = useState(() => localStorage.getItem(rememberedEmailKey) || "");
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(Boolean(localStorage.getItem(rememberedEmailKey)));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { if (user && profile?.status === "active") navigate("/admin", { replace: true }); }, [user, profile, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (rememberEmail) localStorage.setItem(rememberedEmailKey, email.trim());
      else localStorage.removeItem(rememberedEmailKey);
      await signIn(email.trim(), password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
      setPassword("");
    }
  };
  const sendRecovery = async () => {
    if (!email.includes("@")) return setError("请先输入管理员邮箱");
    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${window.location.pathname}#/login` });
    setError(recoveryError ? recoveryError.message : "重置密码邮件已发送，请检查邮箱。");
  };
  const sendMagicLink = async () => {
    if (!email.includes("@")) return setError("请先输入管理员邮箱");
    const { error: linkError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}#/admin`, shouldCreateUser: false } });
    setError(linkError ? linkError.message : "邮箱登录链接已发送。");
  };
  if (user && !profile) {
    return <div className="auth-page"><div className="auth-panel access-state"><AuthBrand /><Link className="back-link" to="/"><ArrowLeft />返回网站</Link>{authLoading ? <LoaderCircle className="spin" /> : <ShieldAlert />}<h1>{authLoading ? "正在检查后台权限" : "账号已登录，暂时无法进入后台"}</h1><p>当前账号：{user.email}</p><div className="form-message">{authLoading ? "正在读取管理员资料..." : profileError || "正式权限表尚未部署，或者这个账号还没有管理员权限。"}</div><div className="auth-secondary"><button className="button primary" type="button" disabled={authLoading} onClick={() => refreshProfile()}><RefreshCw />重新检查权限</button><button className="button quiet" type="button" onClick={() => signOut()}><LogOut />退出登录</button></div></div></div>;
  }
  return <div className="auth-page"><div className="auth-panel"><AuthBrand /><Link className="back-link" to="/"><ArrowLeft />返回网站</Link><h1>管理员登录</h1><p>后台不开放注册。新管理员由超级管理员邀请并分配权限。</p><form onSubmit={submit} className="form-stack"><label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><label className="checkbox"><input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} />只记住邮箱，不保存密码</label>{error && <div className="form-message">{error}</div>}<button className="button primary" disabled={loading} type="submit"><LogIn />{loading ? "正在登录..." : "登录后台"}</button></form><div className="auth-secondary"><button className="button quiet" type="button" onClick={sendRecovery}><KeyRound />重置密码</button><button className="button quiet" type="button" onClick={sendMagicLink}><Mail />邮箱链接</button></div></div></div>;
}

function AuthBrand() {
  return <div className="auth-brand"><span>NK</span><div><strong>MapleStoryNK</strong><small>内容管理中心</small></div></div>;
}
