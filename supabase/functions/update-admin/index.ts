import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

const allowedRoles = ["super_admin", "editor", "uploader", "viewer"];
const allowedStatuses = ["invited", "active", "disabled"];

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user } = await requireRole(request, ["super_admin"]);
  const body = await request.json();
  const userId = String(body.userId ?? "");
  const role = String(body.role ?? "viewer");
  const status = String(body.status ?? "active");
  const displayName = String(body.displayName ?? "").trim();
  const password = String(body.password ?? "");
  if (!userId || !allowedRoles.includes(role) || !allowedStatuses.includes(status)) {
    return json({ error: "Invalid account data" }, 400);
  }
  if (userId === user.id && (role !== "super_admin" || status !== "active")) {
    return json({ error: "You cannot remove your own active super administrator access" }, 400);
  }

  const authChanges: Record<string, unknown> = {
    ban_duration: status === "disabled" ? "876000h" : "none",
    user_metadata: { username: displayName }
  };
  if (password) {
    if (password.length < 8) return json({ error: "Password must contain at least 8 characters" }, 400);
    authChanges.password = password;
  }
  const { error: authError } = await client.auth.admin.updateUserById(userId, authChanges);
  if (authError) return json({ error: authError.message }, 400);

  const { error: profileError } = await client.from("profiles").update({
    role,
    status,
    display_name: displayName,
    updated_by: user.id
  }).eq("id", userId);
  if (profileError) return json({ error: profileError.message }, 400);
  return json({ userId, role, status });
}));
