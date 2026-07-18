-- Deprecated compatibility file.
-- Do not use the former site_state-only policies for new deployments: they allowed
-- every authenticated user to overwrite the complete website.
--
-- Apply this migration instead:
-- supabase/migrations/20260719010000_professional_backend.sql

do $$
begin
  raise notice 'MapleStoryNK: use supabase/migrations/20260719010000_professional_backend.sql';
end $$;
