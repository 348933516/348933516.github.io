import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const systemAdmin = fs.readFileSync(path.resolve(process.cwd(), "app/src/pages/admin/SystemAdmin.tsx"), "utf8");

describe("COS media storage policy", () => {
  it("keeps legacy media in Supabase and disables starting another migration", () => {
    const panel = systemAdmin.slice(systemAdmin.indexOf("function MediaMigrationPanel"), systemAdmin.indexOf("function auditText"));
    expect(panel).toContain("旧数据：保留，不迁移、不删除");
    expect(panel).toContain("新上传：腾讯 COS + EdgeOne");
    expect(panel).not.toContain("开始复制并核验");
    expect(panel).not.toContain("确认切换并删除旧文件");
  });
});
