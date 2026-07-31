import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260801090000_outline_privacy_and_public_performance.sql"), "utf8");
const publish = fs.readFileSync(path.join(root, "supabase/functions/publish-content/index.ts"), "utf8");
const privacy = fs.readFileSync(path.join(root, "supabase/functions/attachment-privacy/index.ts"), "utf8");

describe("outline and attachment privacy migration", () => {
  it("defaults public outlines off and omits attachments from the public RPC", () => {
    expect(migration).toContain("outline_enabled boolean not null default false");
    const publicContent = migration.slice(migration.indexOf("create or replace function public.get_public_content"), migration.indexOf("revoke all on function public.get_public_content"));
    expect(publicContent).not.toContain("public.attachments");
    expect(migration).toContain("revoke select on public.attachments from anon");
  });

  it("keeps new attachments private during publication and migrates old copies safely", () => {
    expect(publish).not.toContain('table: "attachments" as const');
    expect(privacy).toContain("commit_private_attachment");
    expect(privacy).toContain("headCosObject");
    expect(privacy.indexOf("headCosObject")).toBeLessThan(privacy.indexOf("commit_private_attachment"));
  });

  it("uses one RPC for carousel ordering and a settings-only public shell", () => {
    expect(migration).toContain("reorder_carousel_slides");
    expect(migration).toContain("get_public_shell");
  });
});
