-- Provider-aware media storage. Existing rows remain on Supabase until the
-- explicit migration task verifies their COS copies.

alter table public.content_media add column if not exists storage_provider text not null default 'supabase';
alter table public.attachments add column if not exists storage_provider text not null default 'supabase';
alter table public.document_imports add column if not exists storage_provider text not null default 'supabase';
alter table public.document_imports add column if not exists storage_bucket text;
alter table public.document_imports add column if not exists public_storage_bucket text;
alter table public.document_import_assets add column if not exists storage_provider text not null default 'supabase';
alter table public.document_import_assets add column if not exists storage_bucket text;
alter table public.document_import_assets add column if not exists promotion_status text not null default 'ready';
alter table public.document_import_assets add column if not exists promoted_at timestamptz;
alter table public.storage_cleanup_queue add column if not exists storage_provider text not null default 'supabase';

alter table public.site_settings add column if not exists top_logo_provider text not null default 'supabase';
alter table public.site_settings add column if not exists hero_logo_provider text not null default 'supabase';
alter table public.site_settings add column if not exists page_background_provider text not null default 'supabase';
alter table public.site_settings add column if not exists tile_background_provider text not null default 'supabase';
alter table public.categories add column if not exists image_provider text not null default 'supabase';
alter table public.carousel_slides add column if not exists image_provider text not null default 'supabase';

do $$ begin
  alter table public.content_media add constraint content_media_storage_provider_check check (storage_provider in ('supabase', 'tencent_cos'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.attachments add constraint attachments_storage_provider_check check (storage_provider in ('supabase', 'tencent_cos'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.document_imports add constraint document_imports_storage_provider_check check (storage_provider in ('supabase', 'tencent_cos'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.document_import_assets add constraint document_import_assets_storage_provider_check check (storage_provider in ('supabase', 'tencent_cos'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.document_import_assets add constraint document_import_assets_promotion_status_check check (promotion_status in ('pending', 'copying', 'ready', 'failed'));
exception when duplicate_object then null; end $$;

create table if not exists public.media_storage_migrations (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'copying', 'verifying', 'committing', 'completed', 'failed', 'cancelled')),
  total_objects integer not null default 0,
  completed_objects integer not null default 0,
  total_bytes bigint not null default 0,
  completed_bytes bigint not null default 0,
  error_message text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.media_storage_migration_items (
  id bigint generated always as identity primary key,
  migration_id uuid not null references public.media_storage_migrations(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  field_name text not null,
  source_bucket text not null,
  source_path text not null,
  destination_bucket text not null,
  destination_path text not null,
  size_bytes bigint not null default 0,
  etag text,
  status text not null default 'pending' check (status in ('pending', 'uploading', 'verified', 'committed', 'failed')),
  retry_count integer not null default 0,
  error_message text,
  updated_at timestamptz not null default now(),
  unique(migration_id, source_bucket, source_path)
);

create index if not exists media_storage_migration_items_status_idx on public.media_storage_migration_items(migration_id, status, id);
alter table public.media_storage_migrations enable row level security;
alter table public.media_storage_migration_items enable row level security;
drop policy if exists media_storage_migrations_admin on public.media_storage_migrations;
create policy media_storage_migrations_admin on public.media_storage_migrations for all to authenticated
using (public.current_profile_role() = 'super_admin') with check (public.current_profile_role() = 'super_admin');
drop policy if exists media_storage_migration_items_admin on public.media_storage_migration_items;
create policy media_storage_migration_items_admin on public.media_storage_migration_items for all to authenticated
using (public.current_profile_role() = 'super_admin') with check (public.current_profile_role() = 'super_admin');
grant select, insert, update on public.media_storage_migrations to authenticated;
grant select, insert, update on public.media_storage_migration_items to authenticated;

create or replace function public.commit_cos_media_migration(
  p_migration_id uuid,
  p_actor_id uuid,
  p_cos_bucket text,
  p_supabase_base_url text,
  p_media_base_url text
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  job public.media_storage_migrations%rowtype;
  migrated_object public.media_storage_migration_items%rowtype;
  pending_count integer;
  changed_count integer := 0;
begin
  select * into job from public.media_storage_migrations where id = p_migration_id for update;
  if not found then raise exception 'MIGRATION_NOT_FOUND'; end if;
  if job.created_by <> p_actor_id then raise exception 'MIGRATION_FORBIDDEN'; end if;
  select count(*) into pending_count from public.media_storage_migration_items where migration_id = p_migration_id and status not in ('verified', 'committed');
  if pending_count > 0 then raise exception 'MIGRATION_NOT_VERIFIED'; end if;
  update public.media_storage_migrations set status = 'committing', updated_at = now() where id = p_migration_id;

  update public.content_media media set storage_provider = 'tencent_cos', storage_bucket = p_cos_bucket
  where media.storage_provider = 'supabase' and media.storage_bucket = 'maplestorynk-public'
    and exists (
      select 1 from public.media_storage_migration_items item
      where item.migration_id = p_migration_id and item.status in ('verified', 'committed')
        and item.source_bucket = media.storage_bucket
        and item.source_path in (media.storage_path, media.original_storage_path, media.display_storage_path)
    )
    and not exists (
      select 1
      from (
        select media.storage_path as path
        union select media.original_storage_path
        union select media.display_storage_path
        union select variant->>'path' from jsonb_array_elements(coalesce(media.image_variants, '[]'::jsonb)) variant
      ) paths
      where paths.path is not null and paths.path <> '' and not exists (
        select 1 from public.media_storage_migration_items item
        where item.migration_id = p_migration_id and item.status in ('verified', 'committed')
          and item.source_bucket = media.storage_bucket and item.source_path = paths.path
      )
    );
  get diagnostics changed_count = row_count;
  update public.attachments attachment set storage_provider = 'tencent_cos', storage_bucket = p_cos_bucket
  where attachment.storage_provider = 'supabase' and attachment.storage_bucket = 'maplestorynk-public'
    and exists (
      select 1 from public.media_storage_migration_items item
      where item.migration_id = p_migration_id and item.status in ('verified', 'committed')
        and item.source_bucket = attachment.storage_bucket and item.source_path = attachment.storage_path
    );
  update public.site_settings set
    top_logo_provider = case when exists (select 1 from public.media_storage_migration_items item where item.migration_id = p_migration_id and item.status in ('verified', 'committed') and item.source_path = top_logo_path) then 'tencent_cos' else top_logo_provider end,
    hero_logo_provider = case when exists (select 1 from public.media_storage_migration_items item where item.migration_id = p_migration_id and item.status in ('verified', 'committed') and item.source_path = hero_logo_path) then 'tencent_cos' else hero_logo_provider end,
    page_background_provider = case when exists (select 1 from public.media_storage_migration_items item where item.migration_id = p_migration_id and item.status in ('verified', 'committed') and item.source_path = page_background_path) then 'tencent_cos' else page_background_provider end,
    tile_background_provider = case when exists (select 1 from public.media_storage_migration_items item where item.migration_id = p_migration_id and item.status in ('verified', 'committed') and item.source_path = tile_background_path) then 'tencent_cos' else tile_background_provider end
  where id = 'main';
  update public.categories category set image_provider = 'tencent_cos'
  where exists (select 1 from public.media_storage_migration_items item where item.migration_id = p_migration_id and item.status in ('verified', 'committed') and item.source_path = category.image_path);
  update public.carousel_slides slide set image_provider = 'tencent_cos'
  where exists (select 1 from public.media_storage_migration_items item where item.migration_id = p_migration_id and item.status in ('verified', 'committed') and item.source_path = slide.image_path);

  for migrated_object in
    select * from public.media_storage_migration_items
    where migration_id = p_migration_id and status in ('verified', 'committed')
  loop
    update public.contents set body_html = replace(body_html, p_supabase_base_url || migrated_object.source_path, p_media_base_url || migrated_object.destination_path)
    where body_html like '%' || p_supabase_base_url || migrated_object.source_path || '%';
    update public.content_revisions set snapshot = replace(snapshot::text, p_supabase_base_url || migrated_object.source_path, p_media_base_url || migrated_object.destination_path)::jsonb
    where snapshot::text like '%' || p_supabase_base_url || migrated_object.source_path || '%';
  end loop;
  update public.media_storage_migrations set status = 'committing', updated_at = now() where id = p_migration_id;
  return changed_count;
end;
$$;
revoke all on function public.commit_cos_media_migration(uuid, uuid, text, text, text) from public;
grant execute on function public.commit_cos_media_migration(uuid, uuid, text, text, text) to service_role;

create or replace function public.commit_content_publication(
  p_content_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_promotions jsonb
)
returns table(id uuid, version integer, status text, published_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  promotion jsonb;
  target public.contents%rowtype;
begin
  if jsonb_typeof(coalesce(p_promotions, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_PROMOTIONS'; end if;
  select * into target from public.contents where contents.id = p_content_id for update;
  if not found then raise exception 'CONTENT_NOT_FOUND'; end if;
  if target.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;

  for promotion in select value from jsonb_array_elements(coalesce(p_promotions, '[]'::jsonb))
  loop
    if (promotion->>'provider') not in ('supabase', 'tencent_cos')
      or coalesce(promotion->>'destinationBucket', '') = ''
      or coalesce(promotion->>'storagePath', '') = '' then
      raise exception 'INVALID_PROMOTION';
    end if;
    if promotion->>'table' = 'content_media' then
      update public.content_media set
        storage_provider = promotion->>'provider',
        storage_bucket = promotion->>'destinationBucket',
        storage_path = promotion->>'storagePath',
        original_storage_path = nullif(promotion->>'originalStoragePath', ''),
        display_storage_path = nullif(promotion->>'displayStoragePath', ''),
        image_variants = coalesce(promotion->'imageVariants', '[]'::jsonb)
      where content_media.id = (promotion->>'id')::uuid and content_media.content_id = p_content_id;
    elsif promotion->>'table' = 'attachments' then
      update public.attachments set
        storage_provider = promotion->>'provider',
        storage_bucket = promotion->>'destinationBucket',
        storage_path = promotion->>'storagePath'
      where attachments.id = (promotion->>'id')::uuid and attachments.content_id = p_content_id;
    else
      raise exception 'INVALID_PROMOTION_TABLE';
    end if;
    if not found then raise exception 'PROMOTION_TARGET_NOT_FOUND'; end if;
  end loop;

  update public.contents as published_content set status = 'published', updated_by = p_actor_id
  where published_content.id = p_content_id and published_content.version = p_expected_version
  returning published_content.* into target;
  if not found then raise exception 'VERSION_CONFLICT'; end if;
  return query select target.id, target.version, target.status, target.published_at;
end;
$$;
revoke all on function public.commit_content_publication(uuid, integer, uuid, jsonb) from public;
grant execute on function public.commit_content_publication(uuid, integer, uuid, jsonb) to service_role;

drop function if exists public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb);
create function public.finalize_document_import(
  p_import_id uuid, p_content_id uuid, p_expected_version integer, p_actor_id uuid,
  p_body_html text, p_body_text text, p_source_record text, p_manifest jsonb
)
returns table(content_id uuid, version integer, imported_images integer, replaced_images integer, cleanup_files integer)
language plpgsql security definer set search_path = public
as $$
declare
  target public.contents%rowtype;
  import_job public.document_imports%rowtype;
  asset_count integer;
  previous_import_id uuid;
  replaced_count integer := 0;
  cleanup_count integer := 0;
  target_provider text;
  target_bucket text;
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
  if exists(select 1 from public.document_import_assets where import_id = p_import_id and promotion_status <> 'ready') then raise exception 'IMPORT_OBJECTS_NOT_PROMOTED'; end if;
  target_provider := coalesce(import_job.storage_provider, 'supabase');
  target_bucket := coalesce(import_job.public_storage_bucket, 'maplestorynk-public');

  if previous_import_id is not null and previous_import_id <> p_import_id then
    insert into public.storage_cleanup_queue(content_id, source_import_id, storage_provider, storage_bucket, storage_path)
    select distinct media.content_id, media.source_import_id, media.storage_provider, media.storage_bucket, paths.path
    from public.content_media media
    cross join lateral (
      select media.storage_path as path union select media.original_storage_path union select media.display_storage_path
      union select variant->>'path' from jsonb_array_elements(coalesce(media.image_variants, '[]'::jsonb)) variant
    ) paths
    where media.content_id = p_content_id and media.source_import_id = previous_import_id and paths.path is not null and paths.path <> ''
    on conflict (storage_bucket, storage_path) do nothing;
    get diagnostics cleanup_count = row_count;
    delete from public.content_media where content_media.content_id = p_content_id and content_media.source_import_id = previous_import_id;
    get diagnostics replaced_count = row_count;
  end if;

  insert into public.content_media (
    id, content_id, kind, storage_provider, storage_bucket, storage_path, original_storage_path,
    display_storage_path, image_variants, image_variant_status, content_hash, title, alt_text, width, height,
    mime_type, original_mime_type, size_bytes, original_size_bytes, sort_order, processing_status, created_by, source_import_id
  )
  select (asset->>'mediaId')::uuid, p_content_id, 'image', target_provider, target_bucket,
    asset->>'displayPath', asset->>'originalPath', asset->>'displayPath', coalesce(asset->'imageVariants', '[]'::jsonb), 'ready',
    nullif(asset->>'hash', ''), left(coalesce(asset->>'title', '图片'), 300), left(coalesce(asset->>'altText', '图片'), 500),
    nullif(nullif(asset->>'width', '')::integer, 0), nullif(nullif(asset->>'height', '')::integer, 0),
    case when jsonb_array_length(coalesce(asset->'imageVariants', '[]'::jsonb)) > 0 then 'image/webp' else asset->>'mimeType' end,
    asset->>'mimeType', nullif(asset->>'displaySize', '')::bigint, nullif(asset->>'originalSize', '')::bigint,
    nullif(asset->>'sortOrder', '')::integer, 'ready', p_actor_id, p_import_id
  from jsonb_array_elements(p_manifest) asset
  on conflict (id) do update set storage_provider = excluded.storage_provider, storage_bucket = excluded.storage_bucket,
    storage_path = excluded.storage_path, original_storage_path = excluded.original_storage_path,
    display_storage_path = excluded.display_storage_path, image_variants = excluded.image_variants,
    image_variant_status = 'ready', content_hash = excluded.content_hash, title = excluded.title,
    alt_text = excluded.alt_text, width = excluded.width, height = excluded.height, mime_type = excluded.mime_type,
    original_mime_type = excluded.original_mime_type, size_bytes = excluded.size_bytes,
    original_size_bytes = excluded.original_size_bytes, sort_order = excluded.sort_order,
    processing_status = 'ready', source_import_id = p_import_id
  where content_media.content_id = excluded.content_id;

  update public.contents as target_content set body_html = p_body_html, body_text = p_body_text, body_json = '{}'::jsonb,
    source_record = left(p_source_record, 20000), updated_by = p_actor_id, active_document_import_id = p_import_id
  where target_content.id = p_content_id and target_content.version = p_expected_version returning target_content.* into target;
  if not found then raise exception 'VERSION_CONFLICT'; end if;
  update public.document_imports set status = 'completed', manifest = p_manifest, completed_at = now(), error_message = null where id = p_import_id;
  return query select target.id, target.version, asset_count, replaced_count, cleanup_count;
end;
$$;
revoke all on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) from public;
grant execute on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) to service_role;

create or replace function public.get_public_content(content_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  with selected_content as (select * from public.published_contents where slug = content_slug limit 1)
  select case when not exists(select 1 from selected_content) then null else jsonb_build_object(
    'content', (select to_jsonb(selected_content) from selected_content),
    'media', coalesce((select jsonb_agg(to_jsonb(cm) order by cm.sort_order) from public.content_media cm join selected_content sc on sc.id = cm.content_id where cm.source_import_id is null), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a) order by a.sort_order) from public.attachments a join selected_content sc on sc.id = a.content_id where (a.storage_provider = 'tencent_cos' or a.storage_bucket = 'maplestorynk-public' or a.external_url is not null)), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(t.name order by t.name) from public.content_tags ct join public.tags t on t.id = ct.tag_id join selected_content sc on sc.id = ct.content_id), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(to_jsonb(sibling) order by sibling.sort_order) from (
      select pc.id, pc.slug, pc.category_id, pc.category_slug, pc.category_name, pc.title, pc.summary,
        pc.is_featured, pc.sort_order, pc.version, pc.created_at, pc.updated_at, pc.published_at,
        ''::text as cover_path, 'supabase'::text as cover_provider, 0::integer as media_count
      from public.published_contents pc join selected_content sc on sc.category_id = pc.category_id
    ) sibling), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.get_public_content(text) from public;
grant execute on function public.get_public_content(text) to anon, authenticated;

create or replace function public.get_public_home()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', coalesce((select to_jsonb(s) from public.site_settings s where s.id = 'main'), '{}'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order) from (
      select c.id, c.slug, c.name, c.description, c.image_path, c.image_provider, c.sort_order, c.is_visible,
        count(pc.id)::integer as content_count,
        coalesce(first_media.storage_path, '') as first_media_path,
        coalesce(first_media.storage_provider, 'supabase') as first_media_provider
      from public.categories c
      left join public.published_contents pc on pc.category_id = c.id
      left join lateral (
        select cm.storage_path, cm.storage_provider from public.content_media cm
        join public.contents source_content on source_content.id = cm.content_id
        where source_content.category_id = c.id and source_content.status = 'published' and cm.kind = 'image'
          and (cm.storage_provider = 'tencent_cos' or cm.storage_bucket = 'maplestorynk-public')
        order by source_content.sort_order, cm.sort_order limit 1
      ) first_media on true
      where c.is_visible = true
      group by c.id, first_media.storage_path, first_media.storage_provider
    ) row_data), '[]'::jsonb),
    'carousel', coalesce((select jsonb_agg(to_jsonb(cs) order by cs.sort_order) from public.carousel_slides cs where cs.is_visible = true), '[]'::jsonb),
    'backend_mode', 'structured'
  );
$$;

create or replace function public.get_public_category(category_slug text, page_offset integer default 0, page_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  with selected_category as (
    select id, slug, name, description, image_path, image_provider, sort_order, is_visible
    from public.categories where slug = category_slug and is_visible = true limit 1
  ), rows as (
    select pc.id, pc.slug, pc.category_id, pc.category_slug, pc.category_name, pc.title, pc.summary,
      pc.is_featured, pc.sort_order, pc.version, pc.created_at, pc.updated_at, pc.published_at,
      coalesce(cover.storage_path, '') as cover_path, coalesce(cover.storage_provider, 'supabase') as cover_provider,
      coalesce(media_count.value, 0)::integer as media_count
    from public.published_contents pc join selected_category category on category.id = pc.category_id
    left join lateral (
      select cm.storage_path, cm.storage_provider from public.content_media cm
      where cm.content_id = pc.id and cm.kind = 'image'
        and (cm.storage_provider = 'tencent_cos' or cm.storage_bucket = 'maplestorynk-public')
      order by cm.sort_order limit 1
    ) cover on true
    left join lateral (select count(*) as value from public.content_media cm where cm.content_id = pc.id) media_count on true
    order by pc.sort_order, pc.published_at desc, pc.id
    offset greatest(page_offset, 0) limit least(greatest(page_limit, 1), 50)
  )
  select jsonb_build_object(
    'category', (select to_jsonb(selected_category) from selected_category),
    'items', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
    'total', (select count(*) from public.published_contents pc join selected_category category on category.id = pc.category_id)
  );
$$;

revoke all on function public.get_public_home() from public;
revoke all on function public.get_public_category(text, integer, integer) from public;
grant execute on function public.get_public_home() to anon, authenticated;
grant execute on function public.get_public_category(text, integer, integer) to anon, authenticated;

create or replace view public.admin_content_list
with (security_invoker = true) as
select c.id, c.slug, c.category_id, cat.slug as category_slug, cat.name as category_name,
  c.title, c.summary, c.status, c.is_featured, c.sort_order, c.version, c.created_by,
  c.created_at, c.updated_at, c.published_at,
  coalesce(media_counts.media_count, 0)::integer as media_count,
  coalesce(attachment_counts.attachment_count, 0)::integer as attachment_count,
  cover.storage_bucket as cover_bucket, cover.storage_path as cover_path,
  cover.external_url as cover_external_url, cover.storage_provider as cover_provider
from public.contents c
join public.categories cat on cat.id = c.category_id
left join lateral (select count(*) as media_count from public.content_media cm where cm.content_id = c.id) media_counts on true
left join lateral (select count(*) as attachment_count from public.attachments a where a.content_id = c.id) attachment_counts on true
left join lateral (
  select cm.storage_provider, cm.storage_bucket, cm.storage_path, cm.external_url
  from public.content_media cm where cm.content_id = c.id and cm.kind = 'image'
  order by cm.sort_order, cm.created_at limit 1
) cover on true;
revoke all on public.admin_content_list from public, anon;
grant select on public.admin_content_list to authenticated;
