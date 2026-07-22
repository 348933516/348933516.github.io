import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const productionHtml = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
const saveFunction = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/save-content/index.ts"), "utf8");

describe("security regression checks", () => {
  it("does not ship the legacy local login or plaintext credentials", () => {
    expect(productionHtml).toContain('src="/assets/');
    expect(productionHtml).not.toContain("starterAdmins");
    expect(productionHtml).not.toContain("JSON.stringify({ user, pass })");
    expect(productionHtml).not.toContain("supabaseClient.auth.signUp(");
    expect(productionHtml).not.toMatch(/type=["']password["']/i);
  });

  it("sanitizes rich text in the server-side write path", () => {
    expect(saveFunction).toContain('import sanitizeHtml from "npm:sanitize-html');
    expect(saveFunction).toContain('allowedSchemes: ["https"]');
    expect(saveFunction).toContain("Content version changed");
  });
});
