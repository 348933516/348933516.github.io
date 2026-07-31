import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const systemAdmin = fs.readFileSync(path.resolve(process.cwd(), "app/src/pages/admin/SystemAdmin.tsx"), "utf8");
const attachmentPrivacy = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/attachment-privacy/index.ts"), "utf8");

describe("COS media storage policy", () => {
  it("keeps image migration manual while exposing the verified attachment privacy queue", () => {
    const panel = systemAdmin.slice(systemAdmin.indexOf("function MediaMigrationPanel"), systemAdmin.indexOf("function auditText"));
    expect(panel).toContain("旧图片可按需重新上传");
    expect(panel).toContain("附件：仅私有 COS");
    expect(panel).toContain("处理下一批");
    expect(panel).not.toContain("开始复制并核验");
    expect(panel).not.toContain("确认切换并删除旧文件");
  });

  it("keeps a committed attachment in cleanup state when deleting the old public object fails", () => {
    expect(attachmentPrivacy.indexOf("commit_private_attachment")).toBeLessThan(attachmentPrivacy.indexOf("deleteCosObject(sourceBucket"));
    expect(attachmentPrivacy).toContain('status: committedToPrivate ? "cleanup" : "failed"');
  });
});
