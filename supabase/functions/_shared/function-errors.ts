export function functionError(code: string, message: string, stage: string, details: Record<string, unknown> = {}) {
  return {
    error: message,
    code,
    stage,
    request_id: crypto.randomUUID(),
    ...details
  };
}

