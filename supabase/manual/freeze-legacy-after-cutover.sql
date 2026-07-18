-- Run only after the React application and structured tables are verified in production.
-- The row remains available to super administrators for the 30-day rollback window.
do $$
begin
  if to_regclass('public.site_state') is not null then
    execute 'drop policy if exists "site_state_authenticated_insert" on public.site_state';
    execute 'drop policy if exists "site_state_authenticated_update" on public.site_state';
    execute 'drop policy if exists "site_state_public_read" on public.site_state';
    execute 'drop policy if exists "site_state_owner_rollback_read" on public.site_state';
    execute 'create policy "site_state_owner_rollback_read" on public.site_state for select to authenticated using (public.has_any_role(array[''super_admin'']::public.app_role[]))';
    execute 'revoke all on public.site_state from anon';
    execute 'grant select on public.site_state to authenticated';
  end if;
end $$;
