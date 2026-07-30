import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function requireRole(request: Request, roles: string[]) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Response("Unauthorized", { status: 401 });
  const client = adminClient();
  const token = authorization.slice(7);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Response("Unauthorized", { status: 401 });
  const { data: profile } = await client
    .from("profiles")
    .select("id, role, status")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || profile.status !== "active" || !roles.includes(profile.role)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { client, user: data.user, profile };
}

export async function edgeHandler(request: Request, action: () => Promise<Response>) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    return await action();
  } catch (error) {
    if (error instanceof Response) {
      const status = error.status || 500;
      const code = status === 401 ? "AUTH_REQUIRED" : status === 403 ? "ROLE_FORBIDDEN" : status === 404 ? "NOT_FOUND" : "EDGE_REQUEST_FAILED";
      let message = status === 401 ? "登录已失效，请重新登录。" : status === 403 ? "当前账号没有执行此操作的权限。" : "请求处理失败。";
      try {
        const detail = (await error.clone().text()).trim();
        if (detail && !["Unauthorized", "Forbidden"].includes(detail)) message = detail.slice(0, 500);
      } catch {
        // Keep the safe status-specific message.
      }
      return json({ error: message, code, stage: "authorization", request_id: crypto.randomUUID() }, status);
    }
    const requestId = crypto.randomUUID();
    console.error(`[${requestId}]`, error);
    return json({ error: "The server could not complete the request.", code: "EDGE_FUNCTION_UNEXPECTED", request_id: requestId }, 500);
  }
}
