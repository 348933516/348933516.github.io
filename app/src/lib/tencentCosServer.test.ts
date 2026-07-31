import { describe, expect, it } from "vitest";
import { parseCosErrorResponse } from "../../../supabase/functions/_shared/cos-error";

describe("server-side COS requests", () => {
  it("preserves the COS XML code and request ID", () => {
    expect(parseCosErrorResponse({
      detail: "<Error><Code>AccessDenied</Code><Message>permission denied</Message><RequestId>cos-request-123</RequestId></Error>",
      httpStatus: 403,
      bucket: "maplestorynk-media-1331200863",
      operation: "CopyObject"
    })).toMatchObject({
      name: "CosRequestError",
      operation: "CopyObject",
      httpStatus: 403,
      code: "AccessDenied",
      requestId: "cos-request-123",
      bucket: "maplestorynk-media-1331200863"
    });
  });
});
