-- Durable Word import jobs. Files are uploaded first, then the completed
-- document and its media records are committed together by an Edge Function.

create table if not exists public.document_imports (
  id uuid primary key,
  content_id uuid not null references public.contents(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  expected_images integer not null check (expected_images >= 0),
  total_original_bytes bigint not null default 0 check (total_original_bytes >= 0),
  status text not null default 'uploading' check (status in ('uploading', 'completed', 'failed', 'cancelled')),
  manifest jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists document_imports_content_created_idx on public.document_imports(content_id, created_at desc);
create index if not exists document_imports_cleanup_idx on public.document_imports(status, created_at) where status in ('uploading', 'failed', 'cancelled');

drop trigger if exists document_imports_touch on public.document_imports;
create trigger document_imports_touch before update on public.document_imports for each row execute function public.touch_updated_at();

alter table public.document_imports enable row level security;
revoke all on public.document_imports from anon, authenticated;
grant select on public.document_imports to authenticated;

drop policy if exists document_imports_admin_read on public.document_imports;
create policy document_imports_admin_read on public.document_imports for select to authenticated
using (public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]));

create or replace function public.finalize_document_import(
  p_import_id uuid,
  p_content_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_body_html text,
  p_body_text text,
  p_source_record text,
  p_manifest jsonb
)
returns table(content_id uuid, version integer, imported_images integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.contents%rowtype;
  import_job public.document_imports%rowtype;
  asset_count integer;
begin
  select * into import_job from public.document_imports where id = p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if import_job.content_id <> p_content_id or import_job.created_by <> p_actor_id then raise exception 'IMPORT_FORBIDDEN'; end if;
  if import_job.status <> 'uploading' then raise exception 'IMPORT_NOT_PENDING'; end if;

  select * into target from public.contents where id = p_content_id for update;
  if not found then raise exception 'CONTENT_NOT_FOUND'; end if;
  if target.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;

  asset_count := coalesce(jsonb_array_length(p_manifest), 0);
  if asset_count <> import_job.expected_images then raise exception 'IMAGE_COUNT_MISMATCH'; end if;

  insert into public.content_media (
    id, content_id, kind, storage_bucket, storage_path, original_storage_path,
    display_storage_path, content_hash, title, alt_text, width, height,
    mime_type, original_mime_type, size_bytes, original_size_bytes, sort_order, created_by
  )
  select
    (asset->>'mediaId')::uuid, p_content_id, 'image', 'maplestorynk-public',
    asset->>'displayPath', asset->>'originalPath', asset->>'displayPath',
    asset->>'hash', left(coalesce(asset->>'title', '图片'), 300),
    left(coalesce(asset->>'altText', '图片'), 500),
    nullif(asset->>'width', '')::integer, nullif(asset->>'height', '')::integer,
    'image/webp', asset->>'mimeType', nullif(asset->>'displaySize', '')::bigint,
    nullif(asset->>'originalSize', '')::bigint, nullif(asset->>'sortOrder', '')::integer, p_actor_id
  from jsonb_array_elements(p_manifest) asset;

  update public.contents
  set body_html = p_body_html,
      body_text = p_body_text,
      body_json = '{}'::jsonb,
      source_record = left(p_source_record, 20000),
      updated_by = p_actor_id
  where id = p_content_id and version = p_expected_version
  returning * into target;
  if not found then raise exception 'VERSION_CONFLICT'; end if;

  update public.document_imports
  set status = 'completed', manifest = p_manifest, completed_at = now(), error_message = null
  where id = p_import_id;

  return query select target.id, target.version, asset_count;
end;
$$;

revoke all on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) from public;
grant execute on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) to service_role;
