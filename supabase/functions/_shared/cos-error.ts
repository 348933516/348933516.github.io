export class CosRequestError extends Error {
  readonly operation: string;
  readonly httpStatus: number | null;
  readonly code: string;
  readonly requestId: string | null;
  readonly bucket: string;

  constructor(input: { operation: string; httpStatus?: number | null; code: string; requestId?: string | null; bucket: string; message: string }) {
    super(input.message);
    this.name = "CosRequestError";
    this.operation = input.operation;
    this.httpStatus = input.httpStatus ?? null;
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.bucket = input.bucket;
  }
}

function xmlValue(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return (match?.[1] || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}

export function parseCosErrorResponse(input: {
  detail: string;
  httpStatus: number;
  headerRequestId?: string | null;
  operation: string;
  bucket: string;
}) {
  const code = xmlValue(input.detail, "Code") || `HTTP_${input.httpStatus}`;
  const requestId = xmlValue(input.detail, "RequestId") || input.headerRequestId || null;
  const upstreamMessage = xmlValue(input.detail, "Message");
  return new CosRequestError({
    operation: input.operation,
    httpStatus: input.httpStatus,
    code,
    requestId,
    bucket: input.bucket,
    message: `COS ${input.operation} failed: ${code}${requestId ? ` (request ID ${requestId})` : ""}${upstreamMessage ? ` - ${upstreamMessage.slice(0, 240)}` : ""}`
  });
}
