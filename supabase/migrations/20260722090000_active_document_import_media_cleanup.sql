-- Track the active Word import so re-imports replace their own media without
-- touching manually uploaded galleries, videos or editor images.

alter table public.contents
  add column if not exists active_document_import_id uuid references public.document_imports(id) on delete set null;

alter table public.content_media
  add column if not exists source_import_id uuid references public.document_imports(id) on delete set null;

create index if not exists content_media_source_import_idx
  on public.content_media(content_id, source_import_id, sort_order);

create table if not exists public.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  content_id uuid references public.contents(id) on delete cascade,
  source_import_id uuid references public.document_imports(id) on delete set null,
  storage_bucket text not null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(storage_bucket, storage_path)
);

alter table public.storage_cleanup_queue enable row level security;
revoke all on public.storage_cleanup_queue from anon, authenticated;

update public.content_media media
set source_import_id = asset.import_id
from public.document_import_assets asset
where asset.media_id = media.id
  and media.source_import_id is null;

with referenced_imports as (
  select imports.content_id, imports.id as import_id, imports.completed_at, imports.created_at,
    row_number() over (
      partition by imports.content_id
      order by imports.completed_at desc nulls last, imports.created_at desc
    ) as position
  from public.document_imports imports
  join public.contents content on content.id = imports.content_id
  where imports.status = 'completed'
    and exists (
      select 1 from public.document_import_assets asset
      where asset.import_id = imports.id
        and strpos(coalesce(content.body_html, ''), asset.media_id::text) > 0
    )
)
update public.contents content
set active_document_import_id = referenced.import_id
from referenced_imports referenced
where referenced.content_id = content.id
  and referenced.position = 1
  and content.active_document_import_id is null;

insert into public.storage_cleanup_queue(content_id, source_import_id, storage_bucket, storage_path)
select distinct media.content_id, media.source_import_id, media.storage_bucket, paths.path
from public.content_media media
join public.contents content on content.id = media.content_id
cross join lateral (
  select media.storage_path as path
  union select media.original_storage_path
  union select media.display_storage_path
  union select variant->>'path' from jsonb_array_elements(coalesce(media.image_variants, '[]'::jsonb)) variant
) paths
where media.source_import_id is not null
  and content.active_document_import_id is not null
  and media.source_import_id <> content.active_document_import_id
  and paths.path is not null and paths.path <> ''
on conflict (storage_bucket, storage_path) do nothing;

delete from public.content_media media
using public.contents content
where media.content_id = content.id
  and media.source_import_id is not null
  and content.active_document_import_id is not null
  and media.source_import_id <> content.active_document_import_id;

drop function if exists public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb);
create function public.finalize_document_import(
  p_import_id uuid,
  p_content_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_body_html text,
  p_body_text text,
  p_source_record text,
  p_manifest jsonb
)
returns table(content_id uuid, version integer, imported_images integer, replaced_images integer, cleanup_files integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.contents%rowtype;
  import_job public.document_imports%rowtype;
  asset_count integer;
  previous_import_id uuid;
  replaced_count integer := 0;
  cleanup_count integer := 0;
begin
  select * into import_job from public.document_imports where id = p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if import_job.content_id <> p_content_id or import_job.created_by <> p_actor_id then raise exception 'IMPORT_FORBIDDEN'; end if;
  if import_job.status <> 'uploading' then raise exception 'IMPORT_NOT_PENDING'; end if;

  select * into target from public.contents where id = p_content_id for update;
  if not found then raise exception 'CONTENT_NOT_FOUND'; end if;
  if target.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  previous_import_id := target.active_document_import_id;

  asset_count := coalesce(jsonb_array_length(p_manifest), 0);
  if asset_count <> import_job.expected_images then raise exception 'IMAGE_COUNT_MISMATCH'; end if;

  if previous_import_id is not null and previous_import_id <> p_import_id then
    insert into public.storage_cleanup_queue(content_id, source_import_id, storage_bucket, storage_path)
    select distinct media.content_id, media.source_import_id, media.storage_bucket, paths.path
    from public.content_media media
    cross join lateral (
      select media.storage_path as path
      union select media.original_storage_path
      union select media.display_storage_path
      union select variant->>'path' from jsonb_array_elements(coalesce(media.image_variants, '[]'::jsonb)) variant
    ) paths
    where media.content_id = p_content_id
      and media.source_import_id = previous_import_id
      and paths.path is not null and paths.path <> ''
    on conflict (storage_bucket, storage_path) do nothing;
    get diagnostics cleanup_count = row_count;

    delete from public.content_media
    where content_media.content_id = p_content_id
      and content_media.source_import_id = previous_import_id;
    get diagnostics replaced_count = row_count;
  end if;

  insert into public.content_media (
    id, content_id, kind, storage_bucket, storage_path, original_storage_path,
    display_storage_path, image_variants, image_variant_status, content_hash, title, alt_text, width, height,
    mime_type, original_mime_type, size_bytes, original_size_bytes,
    sort_order, processing_status, created_by, source_import_id
  )
  select
    (asset->>'mediaId')::uuid, p_content_id, 'image', 'maplestorynk-public',
    asset->>'displayPath', asset->>'originalPath', asset->>'displayPath',
    coalesce(asset->'imageVariants', '[]'::jsonb), 'ready',
    nullif(asset->>'hash', ''), left(coalesce(asset->>'title', '图片'), 300),
    left(coalesce(asset->>'altText', '图片'), 500),
    nullif(nullif(asset->>'width', '')::integer, 0),
    nullif(nullif(asset->>'height', '')::integer, 0),
    case when jsonb_array_length(coalesce(asset->'imageVariants', '[]'::jsonb)) > 0 then 'image/webp' else asset->>'mimeType' end,
    asset->>'mimeType', nullif(asset->>'displaySize', '')::bigint,
    nullif(asset->>'originalSize', '')::bigint,
    nullif(asset->>'sortOrder', '')::integer, 'ready', p_actor_id, p_import_id
  from jsonb_array_elements(p_manifest) asset
  on conflict (id) do update set
    storage_path = excluded.storage_path,
    original_storage_path = excluded.original_storage_path,
    display_storage_path = excluded.display_storage_path,
    image_variants = excluded.image_variants,
    image_variant_status = 'ready', content_hash = excluded.content_hash,
    title = excluded.title, alt_text = excluded.alt_text, width = excluded.width,
    height = excluded.height, mime_type = excluded.mime_type,
    original_mime_type = excluded.original_mime_type, size_bytes = excluded.size_bytes,
    original_size_bytes = excluded.original_size_bytes, sort_order = excluded.sort_order,
    processing_status = 'ready', source_import_id = p_import_id
  where content_media.content_id = excluded.content_id;

  update public.contents as target_content
  set body_html = p_body_html, body_text = p_body_text, body_json = '{}'::jsonb,
      source_record = left(p_source_record, 20000), updated_by = p_actor_id,
      active_document_import_id = p_import_id
  where target_content.id = p_content_id and target_content.version = p_expected_version
  returning target_content.* into target;
  if not found then raise exception 'VERSION_CONFLICT'; end if;

  update public.document_imports
  set status = 'completed', manifest = p_manifest, completed_at = now(), error_message = null
  where id = p_import_id;

  return query select target.id, target.version, asset_count, replaced_count, cleanup_count;
end;
$$;

revoke all on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) from public;
grant execute on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) to service_role;

create or replace function public.reorder_content_media(p_content_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_any_role(array['super_admin','editor','uploader']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  update public.content_media media
  set sort_order = requested.sort_order
  from (
    select (item->>'id')::uuid id, (item->>'sortOrder')::integer sort_order
    from jsonb_array_elements(p_items) entries(item)
  ) requested
  where media.id = requested.id
    and media.content_id = p_content_id
    and media.source_import_id is null;
end;
$$;

revoke all on function public.reorder_content_media(uuid, jsonb) from public;
grant execute on function public.reorder_content_media(uuid, jsonb) to authenticated;

create or replace function public.get_admin_category_counts()
returns table(category_id uuid, content_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select content.category_id, count(*)
    from public.contents content
    where content.status <> 'trashed'
    group by content.category_id;
end;
$$;

revoke all on function public.get_admin_category_counts() from public;
grant execute on function public.get_admin_category_counts() to authenticated;

create or replace function public.reorder_categories(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_any_role(array['super_admin','editor']::public.app_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  update public.categories category
  set sort_order = requested.sort_order, updated_by = auth.uid()
  from (
    select (item->>'id')::uuid id, (item->>'sortOrder')::integer sort_order
    from jsonb_array_elements(p_items) entries(item)
  ) requested
  where category.id = requested.id;
end;
$$;

revoke all on function public.reorder_categories(jsonb) from public;
grant execute on function public.reorder_categories(jsonb) to authenticated;

create or replace function public.get_public_content(content_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_content as (
    select * from public.published_contents where slug = content_slug limit 1
  )
  select case when not exists(select 1 from selected_content) then null else jsonb_build_object(
    'content', (select to_jsonb(selected_content) from selected_content),
    'media', coalesce((select jsonb_agg(to_jsonb(cm) order by cm.sort_order) from public.content_media cm join selected_content sc on sc.id = cm.content_id where cm.source_import_id is null), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a) order by a.sort_order) from public.attachments a join selected_content sc on sc.id = a.content_id where a.storage_bucket = 'maplestorynk-public' or a.external_url is not null), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(t.name order by t.name) from public.content_tags ct join public.tags t on t.id = ct.tag_id join selected_content sc on sc.id = ct.content_id), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(to_jsonb(sibling) order by sibling.sort_order) from (
      select pc.id, pc.slug, pc.category_id, pc.category_slug, pc.category_name, pc.title, pc.summary,
        pc.is_featured, pc.sort_order, pc.version, pc.created_at, pc.updated_at, pc.published_at,
        ''::text as cover_path, 0::integer as media_count
      from public.published_contents pc join selected_content sc on sc.category_id = pc.category_id
    ) sibling), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_public_content(text) from public;
grant execute on function public.get_public_content(text) to anon, authenticated;
