import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

type BatchItem = { id: string; version: number };

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user, profile } = await requireRole(request, ["super_admin", "editor"]);
  const body = await request.json();
  const items = Array.isArray(body.items) ? body.items as BatchItem[] : [];
  const action = String(body.action ?? "");
  const categoryId = body.categoryId ? String(body.categoryId) : "";
  const allowedActions = ["move", "draft", "hidden", "trashed"];

  if (!items.length || items.length > 100 || !allowedActions.includes(action)) {
    return json({ error: "Invalid batch request" }, 400);
  }
  if (action === "move" && !categoryId) return json({ error: "A category is required" }, 400);
  if (action === "trashed" && profile.role !== "super_admin") {
    return json({ error: "Only a super administrator can move content to trash" }, 403);
  }

  const results: Array<{ id: string; ok: boolean; version?: number; error?: string }> = [];
  for (const item of items) {
    const id = String(item.id ?? "");
    const version = Number(item.version);
    if (!id || !Number.isFinite(version)) {
      results.push({ id, ok: false, error: "Invalid item" });
      continue;
    }
    const patch = action === "move"
      ? { category_id: categoryId, updated_by: user.id }
      : { status: action, updated_by: user.id };
    const { data, error } = await client.from("contents").update(patch)
      .eq("id", id).eq("version", version).select("id, version").maybeSingle();
    results.push(data && !error
      ? { id, ok: true, version: data.version }
      : { id, ok: false, error: error?.message ?? "VERSION_CONFLICT" });
  }

  return json({ results, succeeded: results.filter((item) => item.ok).length });
}));
