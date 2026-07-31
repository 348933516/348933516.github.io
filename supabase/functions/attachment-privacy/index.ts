import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { copyCosObject, cosConfiguration, deleteCosObject, headCosObject, signedCosUploadUrl } from "../_shared/tencent-cos.ts";

function safeName(path: string) {
  return path.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "-") || crypto.randomUUID();
}

Deno.serve((request) => edgeHandler(request, async () => {
  const { client } = await requireRole(request, ["super_admin"]);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "status");
  const configuration = cosConfiguration();

  if (action === "status") {
    const { data, error } = await client.from("attachment_privacy_jobs").select("id,attachment_id,status,retry_count,size_bytes,error_message,updated_at,completed_at").order("created_at").limit(500);
    if (error) return json({ error: error.message }, 400);
    const rows = data || [];
    return json({
      total: rows.length,
      completed: rows.filter((row) => row.status === "completed").length,
      failed: rows.filter((row) => row.status === "failed").length,
      pending: rows.filter((row) => !["completed", "failed"].includes(row.status)).length,
      items: rows
    });
  }

  if (action !== "run" && action !== "retry") return json({ error: "Unsupported attachment privacy action" }, 400);
  if (action === "retry") {
    const jobId = String(body.jobId || "");
    const { error } = await client.from("attachment_privacy_jobs").update({ status: "queued", error_message: null, updated_at: new Date().toISOString() }).eq("id", jobId).eq("status", "failed");
    if (error) return json({ error: error.message }, 400);
  }

  const limit = Math.min(10, Math.max(1, Number(body.limit || 5)));
  const { data: jobs, error: jobsError } = await client.from("attachment_privacy_jobs")
    .select("*").in("status", ["queued", "failed", "cleanup"]).order("created_at").limit(limit);
  if (jobsError) return json({ error: jobsError.message }, 400);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const job of jobs || []) {
    let committedToPrivate = job.status === "cleanup";
    try {
      const { data: attachment, error: attachmentError } = await client.from("attachments").select("id,content_id,storage_provider,storage_bucket,storage_path,mime_type,size_bytes").eq("id", job.attachment_id).maybeSingle();
      if (attachmentError || !attachment) throw new Error(attachmentError?.message || "Attachment not found");
      const sourceProvider = String(job.source_provider || attachment.storage_provider || "supabase");
      const sourceBucket = String(job.source_bucket || attachment.storage_bucket || "");
      const sourcePath = String(job.source_path || attachment.storage_path || "");
      const destination = String(job.destination_path || `content/${attachment.content_id}/attachments/${attachment.id}/${crypto.randomUUID()}-${safeName(sourcePath)}`);

      if (job.status !== "cleanup") {
        await client.from("attachment_privacy_jobs").update({ status: "copying", retry_count: Number(job.retry_count || 0) + 1, destination_path: destination, updated_at: new Date().toISOString() }).eq("id", job.id);
        if (sourceProvider === "tencent_cos") {
          await copyCosObject(sourceBucket, sourcePath, configuration.privateBucket, destination, { sourceContentType: attachment.mime_type || "application/octet-stream", verifyDestination: true });
        } else {
          const { data: file, error: downloadError } = await client.storage.from(sourceBucket).download(sourcePath);
          if (downloadError || !file) throw new Error(downloadError?.message || "Attachment download failed");
          const uploadUrl = await signedCosUploadUrl(configuration.privateBucket, destination, attachment.mime_type || file.type || "application/octet-stream", "private, no-store");
          const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": attachment.mime_type || file.type || "application/octet-stream", "cache-control": "private, no-store" }, body: file });
          if (!uploaded.ok) throw new Error(`Private COS upload failed (${uploaded.status})`);
        }
        const verified = await headCosObject(configuration.privateBucket, destination);
        const expectedSize = Number(attachment.size_bytes || job.size_bytes || 0);
        if (expectedSize > 0 && verified.sizeBytes !== expectedSize) throw new Error(`Attachment size mismatch: ${expectedSize}/${verified.sizeBytes}`);
        await client.from("attachment_privacy_jobs").update({ status: "verified", etag: verified.etag, size_bytes: verified.sizeBytes, updated_at: new Date().toISOString() }).eq("id", job.id);
        const { error: commitError } = await client.rpc("commit_private_attachment", { p_job_id: job.id, p_attachment_id: attachment.id, p_bucket: configuration.privateBucket, p_path: destination, p_etag: verified.etag });
        if (commitError) throw new Error(commitError.message);
        committedToPrivate = true;
      }

      if (sourceProvider === "tencent_cos") await deleteCosObject(sourceBucket, sourcePath);
      else await client.storage.from(sourceBucket).remove([sourcePath]);
      await client.from("attachment_privacy_jobs").update({ status: "completed", error_message: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
      results.push({ id: job.id, ok: true });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 500);
      await client.from("attachment_privacy_jobs").update({ status: committedToPrivate ? "cleanup" : "failed", error_message: message, updated_at: new Date().toISOString() }).eq("id", job.id);
      results.push({ id: job.id, ok: false, error: message });
    }
  }
  return json({ processed: results.length, results });
}));
