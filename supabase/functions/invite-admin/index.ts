import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

const allowedRoles = ["super_admin", "editor", "uploader", "viewer"];

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user } = await requireRole(request, ["super_admin"]);
  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const displayName = String(body.displayName ?? "").trim();
  const role = String(body.role ?? "viewer");
  if (!email.includes("@") || !allowedRoles.includes(role)) return json({ error: "Invalid account data" }, 400);

  const redirectTo = `${Deno.env.get("PUBLIC_SITE_URL") ?? "https://maplestorynk.online"}/preview/`;
  const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { username: displayName || email }
  });
  if (error || !data.user) return json({ error: error?.message ?? "Invite failed" }, 400);

  const { error: profileError } = await client.from("profiles").upsert({
    id: data.user.id,
    email,
    display_name: displayName || email,
    role,
    status: "active",
    invited_by: user.id,
    updated_by: user.id
  });
  if (profileError) return json({ error: profileError.message }, 400);
  return json({ userId: data.user.id, email, role });
}));
