import { edgeHandler, json, requireRole } from "../_shared/auth.ts";

Deno.serve((request) => edgeHandler(request, async () => {
  const { client, user } = await requireRole(request, ["super_admin", "editor"]);
  const body = await request.json();
  const revisionId = Number(body.revisionId);
  const expectedVersion = Number(body.version);
  if (!Number.isFinite(revisionId) || !Number.isFinite(expectedVersion)) {
    return json({ error: "Invalid revision request" }, 400);
  }

  const { data: revision, error: revisionError } = await client
    .from("content_revisions")
    .select("content_id, snapshot")
    .eq("id", revisionId)
    .single();
  if (revisionError || !revision) return json({ error: revisionError?.message ?? "Revision not found" }, 404);

  const snapshot = revision.snapshot as Record<string, unknown>;
  const { data: restored, error: restoreError } = await client
    .from("contents")
    .update({
      category_id: snapshot.category_id,
      slug: snapshot.slug,
      title: snapshot.title,
      summary: snapshot.summary,
      body_json: snapshot.body_json ?? {},
      body_html: snapshot.body_html ?? "",
      body_text: snapshot.body_text ?? "",
      source_record: snapshot.source_record ?? "",
      status: "draft",
      is_featured: snapshot.is_featured ?? false,
      sort_order: snapshot.sort_order ?? 100,
      scheduled_for: null,
      updated_by: user.id
    })
    .eq("id", revision.content_id)
    .eq("version", expectedVersion)
    .select("id, version, status")
    .maybeSingle();
  if (restoreError || !restored) {
    return json({ error: restoreError?.message ?? "Content version changed", code: "VERSION_CONFLICT" }, 409);
  }
  return json(restored);
}));
