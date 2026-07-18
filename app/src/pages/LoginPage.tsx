import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, LogIn, Mail } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { supabase } from "../lib/supabase";

const rememberedEmailKey = "maplestorynk.admin.email";

export function LoginPage() {
  const { user, profile, signIn } = useAuth();
  const [email, setEmail] = useState(() => localStorage.getItem(rememberedEmailKey) || "");
  const [password, setPassword] = useState("");
  const [rememberEmail, setRememberEmail] = useState(Boolean(localStorage.getItem(rememberedEmailKey)));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { if (user && profile) navigate("/admin", { replace: true }); }, [user, profile, navigate]);

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
  return <div className="auth-page"><div className="auth-panel"><Link className="back-link" to="/"><ArrowLeft />返回网站</Link><span className="eyebrow">ADMIN ACCESS</span><h1>管理员登录</h1><p>后台不开放注册。新管理员由超级管理员邀请并分配权限。</p><form onSubmit={submit} className="form-stack"><label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><label className="checkbox"><input type="checkbox" checked={rememberEmail} onChange={(event) => setRememberEmail(event.target.checked)} />只记住邮箱，不保存密码</label>{error && <div className="form-message">{error}</div>}<button className="button primary" disabled={loading} type="submit"><LogIn />{loading ? "正在登录..." : "登录后台"}</button></form><div className="auth-secondary"><button className="button quiet" type="button" onClick={sendRecovery}><KeyRound />重置密码</button><button className="button quiet" type="button" onClick={sendMagicLink}><Mail />邮箱链接</button></div></div></div>;
}
