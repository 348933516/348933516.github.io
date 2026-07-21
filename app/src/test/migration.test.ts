import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260719010000_professional_backend.sql"), "utf8");
const freezeLegacy = fs.readFileSync(path.resolve(process.cwd(), "supabase/manual/freeze-legacy-after-cutover.sql"), "utf8");
const migrateLegacy = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/migrate-legacy/index.ts"), "utf8");
const removeOfficialAssets = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260719020000_remove_official_assets.sql"), "utf8");
const removeStockMedia = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260719031000_remove_stock_media.sql"), "utf8");
const mediaAndPublicQueries = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260720160000_media_documents_public_queries.sql"), "utf8");
const documentImports = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260720190000_document_import_jobs.sql"), "utf8");
const allowOriginalWordImageDisplay = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260721030000_allow_original_word_image_display.sql"), "utf8");
const documentImportFinalizeDiagnostics = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260721120000_document_import_finalize_diagnostics.sql"), "utf8");
const documentImportOrdering = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260721130000_document_import_ordering.sql"), "utf8");
const documentImportFunction = fs.readFileSync(path.resolve(process.cwd(), "supabase/functions/document-import/index.ts"), "utf8");

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

  it("uses compact published-only public RPCs and stores lossless media metadata", () => {
    expect(mediaAndPublicQueries).toContain("get_public_home");
    expect(mediaAndPublicQueries).toContain("get_public_category");
    expect(mediaAndPublicQueries).toContain("get_public_content");
    expect(mediaAndPublicQueries).toContain("public.published_contents");
    expect(mediaAndPublicQueries).toContain("original_storage_path");
    expect(mediaAndPublicQueries).toContain("provider_file_id");
    expect(mediaAndPublicQueries).not.toContain("source_record");
  });

  it("commits Word bodies and media records through a durable import job", () => {
    expect(documentImports).toContain("create table if not exists public.document_imports");
    expect(documentImports).toContain("create or replace function public.finalize_document_import");
    expect(documentImports).toContain("IMAGE_COUNT_MISMATCH");
    expect(documentImports).toContain("grant execute on function public.finalize_document_import");
    expect(documentImportFunction).toContain('action === "start"');
    expect(documentImportFunction).toContain('action === "manifest"');
    expect(documentImportFunction).toContain('action !== "finalize"');
    expect(documentImportFunction).toContain('schema("storage").from("objects")');
    expect(documentImportFunction).toContain("STORAGE_OBJECTS_MISSING");
    expect(documentImportFunction).toContain("BODY_IMAGE_MAPPING_MISMATCH");
    expect(documentImportFunction).toContain("IMPORT_VERIFICATION_FAILED");
    expect(documentImportFunction).toContain('action === "retry"');
    expect(documentImportFunction).toContain("databaseError");
    expect(documentImportFinalizeDiagnostics).toContain("on conflict (id) do update");
    expect(documentImportFinalizeDiagnostics).toContain("IMPORT_MEDIA_INSERT_FAILED");
    expect(documentImportFinalizeDiagnostics).toContain("IMPORT_CONTENT_UPDATE_FAILED");
    expect(documentImportOrdering).toContain("drop constraint if exists document_import_assets_import_id_sort_order_key");
    expect(documentImportOrdering).toContain("sort_order = image_index * 10");
    expect(documentImportFunction).toContain("sort_order: item.imageIndex * 10");
  });

  it("removes the legacy path inequality constraint before original Word images are registered", () => {
    expect(allowOriginalWordImageDisplay).toContain("pg_constraint");
    expect(allowOriginalWordImageDisplay).toContain("pg_get_constraintdef");
    expect(allowOriginalWordImageDisplay).toContain("original_path");
    expect(allowOriginalWordImageDisplay).toContain("display_path");
    expect(allowOriginalWordImageDisplay).toContain("drop constraint %I");
    expect(allowOriginalWordImageDisplay).toContain("Word import path compatibility constraint is still present");
  });
});
