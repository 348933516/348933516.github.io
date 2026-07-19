import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260719010000_professional_backend.sql"), "utf8");
const freezeLegacy = fs.readFileSync(path.resolve(process.cwd(), "supabase/manual/freeze-legacy-after-cutover.sql"), "utf8");
const migrateLegacy = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/migrate-legacy/index.ts"), "utf8");
const removeOfficialAssets = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260719020000_remove_official_assets.sql"), "utf8");
const removeStockMedia = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260719031000_remove_stock_media.sql"), "utf8");

describe("Supabase security migration", () => {
  it("uses real role profiles and published-only public content", () => {
    expect(migration).toContain("create table if not exists public.profiles");
    expect(migration).toContain("status = 'published' and deleted_at is null");
    expect(migration).toContain("public.current_profile_role() = 'uploader'");
    expect(migration).toContain("create or replace view public.published_contents");
    expect(migration).toContain("revoke all on public.contents from anon");
    expect(migration).toContain("revoke insert, update, delete on public.profiles from authenticated");
    expect(migration).toContain("revoke insert, update, delete on public.contents from authenticated");
    expect(migration).toContain("Publishing must use the publish-content function");
    const publicView = migration.slice(migration.indexOf("create or replace view public.published_contents"), migration.indexOf("revoke all on public.contents"));
    expect(publicView).not.toContain("source_record");
  });

  it("removes legacy authenticated whole-site writes", () => {
    expect(migration).not.toContain('drop policy if exists "site_state_authenticated_insert"');
    expect(freezeLegacy).toContain('drop policy if exists "site_state_authenticated_insert"');
    expect(freezeLegacy).toContain('drop policy if exists "site_state_authenticated_update"');
    expect(freezeLegacy).toContain('drop policy if exists "site_state_public_read"');
    expect(freezeLegacy).toContain('revoke all on public.site_state from anon');
  });

  it("keeps public and private media separated", () => {
    expect(migration).toContain("maplestorynk-public");
    expect(migration).toContain("maplestorynk-private");
    expect(migration).toContain("public.is_owned_draft_content(content_id)");
    expect(migration).toContain("storage_bucket = 'maplestorynk-public' or external_url is not null");
  });

  it("backs up and verifies legacy data before switching sources", () => {
    expect(migrateLegacy).toContain("migration-backups/site-state-");
    expect(migrateLegacy).toContain("Content count mismatch");
    expect(migrateLegacy).toContain("migration_completed: true");
  });

  it("removes bundled theme references without clearing uploaded backgrounds", () => {
    expect(removeOfficialAssets).toContain("like 'official/%'");
    expect(removeOfficialAssets).toContain("drop column if exists hero_background_path");
    expect(removeOfficialAssets).not.toContain("page_background_path = null");
  });

  it("removes only the prototype Unsplash media records", () => {
    expect(removeStockMedia).toContain("external_url like 'https://images.unsplash.com/%'");
    expect(removeStockMedia).not.toContain("storage_path");
  });
});
