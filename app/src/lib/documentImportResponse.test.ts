import { describe, expect, it } from "vitest";
import { documentImportResponseMessage } from "./documentImportResponse";

describe("documentImportResponseMessage", () => {
  it("preserves the database reason returned by image registration", async () => {
    const response = new Response(JSON.stringify({
      error: "当前图片无法登记到导入任务。",
      code: "ASSET_REGISTRATION_FAILED",
      stage: "register",
      database_error: "new row violates check constraint document_import_assets_check"
    }), { status: 400 });

    await expect(documentImportResponseMessage(response)).resolves.toContain("document_import_assets_check");
    await expect(documentImportResponseMessage(new Response(JSON.stringify({
      error: "当前图片登记信息无效。",
      code: "INVALID_IMPORT_ASSET",
      issues: ["display_path"]
    }), { status: 400 }))).resolves.toContain("字段 display_path");
  });

  it("falls back to plain response text", async () => {
    await expect(documentImportResponseMessage(new Response("gateway timeout", { status: 504 }))).resolves.toBe("gateway timeout");
  });
});

