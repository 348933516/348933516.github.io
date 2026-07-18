import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { loadProfile } from "./lib/repository";
import { supabase } from "./lib/supabase";
import type { Profile } from "./types";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    let active = true;
    const applySession = async (nextSession: Session | null) => {
      if (!active) return;
      setLoading(true);
      setSession(nextSession);
      setProfile(null);
      setProfileError("");
      if (nextSession?.user) {
        try {
          const nextProfile = await loadProfile(nextSession.user);
          if (!active) return;
          setProfile(nextProfile);
          if (!nextProfile) setProfileError("正式权限表尚未启用，或这个账号还没有管理员权限。");
        } catch (error) {
          if (active) setProfileError(error instanceof Error ? error.message : "账号权限读取失败");
        }
      }
      if (active) setLoading(false);
    };
    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => applySession(nextSession));
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user || null,
    profile,
    loading,
    profileError,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async refreshProfile() {
      setLoading(true);
      setProfileError("");
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        setSession(data.session);
        if (!data.session?.user) {
          setProfile(null);
          return;
        }
        const nextProfile = await loadProfile(data.session.user);
        setProfile(nextProfile);
        if (!nextProfile) setProfileError("正式权限表尚未部署，或者这个账号还没有管理员权限。");
      } catch (error) {
        setProfile(null);
        setProfileError(error instanceof Error ? error.message : "账号权限读取失败");
      } finally {
        setLoading(false);
      }
    }
  }), [session, profile, loading, profileError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
