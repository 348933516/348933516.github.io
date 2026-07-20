type DocumentImportErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  stage?: string;
  database_error?: string;
  issues?: string[];
};

export async function documentImportResponseMessage(response: Response) {
  const text = await response.text();
  if (!text) return `HTTP ${response.status}`;

  try {
    const payload = JSON.parse(text) as DocumentImportErrorPayload;
    const summary = payload.error || payload.message || `HTTP ${response.status}`;
    const diagnostics = [
      payload.code,
      payload.stage ? `阶段 ${payload.stage}` : "",
      payload.database_error,
      payload.issues?.length ? `字段 ${payload.issues.join(", ")}` : ""
    ].filter(Boolean);
    return diagnostics.length ? `${summary}（${diagnostics.join("；")}）` : summary;
  } catch {
    return text.slice(0, 500);
  }
}

