-- Keep the admin dashboard independent from full content and media scans.

create or replace function public.get_admin_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_any_role(array[
    'super_admin', 'editor', 'uploader', 'viewer'
  ]::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'published', (select count(*) from public.contents where status = 'published'),
    'draft', (select count(*) from public.contents where status = 'draft'),
    'hidden', (select count(*) from public.contents where status = 'hidden'),
    'trashed', (select count(*) from public.contents where status = 'trashed'),
    'storageBytes',
      coalesce((select sum(size_bytes) from public.content_media), 0)
      + coalesce((select sum(size_bytes) from public.attachments), 0)
  );
end;
$$;

revoke all on function public.get_admin_dashboard_summary() from public;
grant execute on function public.get_admin_dashboard_summary() to authenticated;
