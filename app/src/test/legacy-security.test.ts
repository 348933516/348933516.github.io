import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const legacyHtml = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
const saveFunction = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/save-content/index.ts"), "utf8");

describe("security regression checks", () => {
  it("does not keep the legacy local login or plaintext remembered password", () => {
    expect(legacyHtml).toContain("const starterAdmins = []");
    expect(legacyHtml).toContain("只记住邮箱，不保存密码");
    expect(legacyHtml).not.toContain("JSON.stringify({ user, pass })");
    expect(legacyHtml).not.toContain("supabaseClient.auth.signUp(");
  });

  it("sanitizes rich text in the server-side write path", () => {
    expect(saveFunction).toContain('import sanitizeHtml from "npm:sanitize-html');
    expect(saveFunction).toContain('allowedSchemes: ["https"]');
    expect(saveFunction).toContain("Content version changed");
  });
});
