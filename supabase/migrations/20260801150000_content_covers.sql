-- Dedicated per-content covers with an atomic published pointer.

alter table public.content_media add column if not exists media_role text not null default 'content';
alter table public.content_media add column if not exists cover_original_storage_path text;

do $$ begin
  alter table public.content_media add constraint content_media_role_check check (media_role in ('content', 'cover'));
exception when duplicate_object then null; end $$;

alter table public.contents add column if not exists cover_media_id uuid references public.content_media(id) on delete set null;
alter table public.contents add column if not exists published_cover_media_id uuid references public.content_media(id) on delete set null;

create index if not exists content_media_role_idx on public.content_media(content_id, media_role, kind, sort_order);
create index if not exists contents_cover_media_idx on public.contents(cover_media_id) where cover_media_id is not null;

create or replace function public.validate_content_cover_media()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.cover_media_id is not null and not exists (
    select 1 from public.content_media media
    where media.id = new.cover_media_id and media.content_id = new.id and media.kind = 'image'
  ) then raise exception 'INVALID_COVER_MEDIA'; end if;
  if new.published_cover_media_id is not null and not exists (
    select 1 from public.content_media media
    where media.id = new.published_cover_media_id and media.content_id = new.id and media.kind = 'image'
  ) then raise exception 'INVALID_PUBLISHED_COVER_MEDIA'; end if;
  return new;
end;
$$;

drop trigger if exists contents_validate_cover_media on public.contents;
create trigger contents_validate_cover_media before insert or update of cover_media_id, published_cover_media_id on public.contents
for each row execute function public.validate_content_cover_media();

create or replace function public.cleanup_unreferenced_cover_media(p_content_id uuid, p_media_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  media public.content_media%rowtype;
  object_path text;
  private_bucket text;
begin
  if p_media_id is null then return; end if;
  select * into media from public.content_media
  where id = p_media_id and content_id = p_content_id and media_role = 'cover'
  for update;
  if not found then return; end if;
  if exists (
    select 1 from public.contents content
    where content.id = p_content_id and (content.cover_media_id = p_media_id or content.published_cover_media_id = p_media_id)
  ) then return; end if;

  for object_path in
    select distinct path from (
      values (media.storage_path), (media.original_storage_path), (media.display_storage_path), (media.poster_storage_path)
    ) stored(path)
    where path is not null and path <> ''
    union
    select distinct variant->>'path' from jsonb_array_elements(coalesce(media.image_variants, '[]'::jsonb)) variant
    where coalesce(variant->>'path', '') <> ''
  loop
    insert into public.storage_cleanup_queue(content_id, source_import_id, storage_provider, storage_bucket, storage_path)
    values (p_content_id, media.source_import_id, coalesce(media.storage_provider, 'supabase'), media.storage_bucket, object_path)
    on conflict (storage_bucket, storage_path) do nothing;
  end loop;

  if coalesce(media.cover_original_storage_path, '') <> '' then
    private_bucket := case when media.storage_provider = 'tencent_cos' then 'maplestorynk-private-1331200863' else 'maplestorynk-private' end;
    insert into public.storage_cleanup_queue(content_id, source_import_id, storage_provider, storage_bucket, storage_path)
    values (p_content_id, media.source_import_id, coalesce(media.storage_provider, 'supabase'), private_bucket, media.cover_original_storage_path)
    on conflict (storage_bucket, storage_path) do nothing;
  end if;

  delete from public.content_media where id = p_media_id and content_id = p_content_id;
end;
$$;
revoke all on function public.cleanup_unreferenced_cover_media(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cleanup_unreferenced_cover_media(uuid, uuid) to service_role;

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
  previous_cover_id uuid;
begin
  if jsonb_typeof(coalesce(p_promotions, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_PROMOTIONS'; end if;
  select * into target from public.contents where contents.id = p_content_id for update;
  if not found then raise exception 'CONTENT_NOT_FOUND'; end if;
  if target.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  previous_cover_id := target.published_cover_media_id;

  for promotion in select value from jsonb_array_elements(coalesce(p_promotions, '[]'::jsonb)) loop
    if (promotion->>'provider') not in ('supabase', 'tencent_cos')
      or coalesce(promotion->>'destinationBucket', '') = ''
      or coalesce(promotion->>'storagePath', '') = '' then raise exception 'INVALID_PROMOTION'; end if;
    if promotion->>'table' = 'content_media' then
      update public.content_media set
        storage_provider = promotion->>'provider', storage_bucket = promotion->>'destinationBucket',
        storage_path = promotion->>'storagePath',
        original_storage_path = nullif(promotion->>'originalStoragePath', ''),
        display_storage_path = nullif(promotion->>'displayStoragePath', ''),
        poster_storage_path = nullif(promotion->>'posterStoragePath', ''),
        poster_url = nullif(promotion->>'posterUrl', ''),
        image_variants = coalesce(promotion->'imageVariants', '[]'::jsonb)
      where content_media.id = (promotion->>'id')::uuid and content_media.content_id = p_content_id;
    elsif promotion->>'table' = 'attachments' then
      update public.attachments set storage_provider = promotion->>'provider',
        storage_bucket = promotion->>'destinationBucket', storage_path = promotion->>'storagePath'
      where attachments.id = (promotion->>'id')::uuid and attachments.content_id = p_content_id;
    else raise exception 'INVALID_PROMOTION_TABLE'; end if;
    if not found then raise exception 'PROMOTION_TARGET_NOT_FOUND'; end if;
  end loop;

  update public.contents as published_content set
    status = 'published',
    published_cover_media_id = published_content.cover_media_id,
    updated_by = p_actor_id
  where published_content.id = p_content_id and published_content.version = p_expected_version
  returning published_content.* into target;
  if not found then raise exception 'VERSION_CONFLICT'; end if;

  if previous_cover_id is distinct from target.published_cover_media_id then
    perform public.cleanup_unreferenced_cover_media(p_content_id, previous_cover_id);
  end if;
  return query select target.id, target.version, target.status::text, target.published_at;
end;
$$;
revoke all on function public.commit_content_publication(uuid, integer, uuid, jsonb) from public;
grant execute on function public.commit_content_publication(uuid, integer, uuid, jsonb) to service_role;

create or replace view public.published_contents
with (security_barrier = true) as
select
  content.id, content.category_id, content.slug, content.title, content.summary,
  content.body_html, content.body_text, content.is_featured, content.sort_order,
  content.version, content.published_at, content.created_at, content.updated_at,
  category.slug as category_slug, category.name as category_name,
  content.outline_enabled, content.outline_settings,
  content.published_cover_media_id as cover_media_id
from public.contents content
join public.categories category on category.id = content.category_id
where content.status = 'published' and content.deleted_at is null and category.is_visible = true;
revoke all on public.published_contents from public;
grant select on public.published_contents to anon, authenticated;

create or replace function public.get_public_content(content_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  with selected_content as (select * from public.published_contents where slug = content_slug limit 1),
  selected_category as (
    select category.* from public.categories category join selected_content content on content.category_id = category.id limit 1
  )
  select case when not exists(select 1 from selected_content) then null else jsonb_build_object(
    'content', (select to_jsonb(content_row) from (
      select content.*,
        case when cover.external_url is null then coalesce(cover.storage_path, category.image_path, '') else '' end as cover_path,
        case when cover.external_url is null then coalesce(cover.storage_provider, category.image_provider, 'supabase') else 'external' end as cover_provider,
        cover.external_url as cover_external_url
      from selected_content content join selected_category category on true
      left join lateral (
        select candidate.storage_path, candidate.storage_provider, candidate.external_url from (
          select media.storage_path, media.storage_provider, media.external_url, 0 as priority, media.sort_order
          from public.content_media media where media.id = content.cover_media_id and media.kind = 'image' and (
            (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863' and media.storage_path is not null)
            or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public' and media.storage_path is not null)
            or media.external_url is not null)
          union all
          select media.storage_path, media.storage_provider, media.external_url, 1, media.sort_order
          from public.content_media media where media.content_id = content.id and media.kind = 'image' and coalesce(media.media_role, 'content') = 'content' and (
            (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863' and media.storage_path is not null)
            or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public' and media.storage_path is not null)
            or media.external_url is not null)
        ) candidate order by candidate.priority, candidate.sort_order limit 1
      ) cover on true
    ) content_row),
    'media', coalesce((select jsonb_agg(to_jsonb(media) order by media.sort_order) from public.content_media media join selected_content content on content.id = media.content_id
      where coalesce(media.media_role, 'content') = 'content' and media.source_import_id is null and (
        (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863' and media.storage_path is not null)
        or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public' and media.storage_path is not null)
        or media.external_url is not null or (media.video_provider = 'tencent_vod' and media.provider_file_id is not null))), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(tag.name order by tag.name) from public.content_tags content_tag join public.tags tag on tag.id = content_tag.tag_id join selected_content content on content.id = content_tag.content_id), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(to_jsonb(sibling) order by sibling.sort_order) from (
      select content.id, content.slug, content.category_id, content.category_slug, content.category_name, content.title, content.summary,
        content.is_featured, content.sort_order, content.version, content.created_at, content.updated_at, content.published_at,
        case when cover.external_url is null then coalesce(cover.storage_path, category.image_path, '') else '' end as cover_path,
        case when cover.external_url is null then coalesce(cover.storage_provider, category.image_provider, 'supabase') else 'external' end as cover_provider,
        cover.external_url as cover_external_url, 0::integer as media_count
      from public.published_contents content join selected_content selected on selected.category_id = content.category_id
      join selected_category category on category.id = content.category_id
      left join lateral (
        select candidate.storage_path, candidate.storage_provider, candidate.external_url from (
          select media.storage_path, media.storage_provider, media.storage_bucket, media.external_url, 0 as priority, media.sort_order from public.content_media media
          where media.id = content.cover_media_id and media.kind = 'image'
          union all
          select media.storage_path, media.storage_provider, media.storage_bucket, media.external_url, 1, media.sort_order from public.content_media media
          where media.content_id = content.id and media.kind = 'image' and coalesce(media.media_role, 'content') = 'content'
        ) candidate where candidate.external_url is not null
          or (candidate.storage_provider = 'tencent_cos' and candidate.storage_bucket = 'maplestorynk-media-1331200863' and candidate.storage_path is not null)
          or (coalesce(candidate.storage_provider, 'supabase') = 'supabase' and candidate.storage_bucket = 'maplestorynk-public' and candidate.storage_path is not null)
        order by candidate.priority, candidate.sort_order limit 1
      ) cover on true
    ) sibling), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.get_public_content(text) from public;
grant execute on function public.get_public_content(text) to anon, authenticated;

create or replace function public.get_public_category(category_slug text, page_offset integer default 0, page_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  with selected_category as (
    select id, slug, name, description, image_path, image_provider, sort_order, is_visible from public.categories where slug = category_slug and is_visible = true limit 1
  ), rows as (
    select content.id, content.slug, content.category_id, content.category_slug, content.category_name, content.title, content.summary,
      content.is_featured, content.sort_order, content.version, content.created_at, content.updated_at, content.published_at,
      case when cover.external_url is null then coalesce(cover.storage_path, category.image_path, '') else '' end as cover_path,
      case when cover.external_url is null then coalesce(cover.storage_provider, category.image_provider, 'supabase') else 'external' end as cover_provider,
      cover.external_url as cover_external_url, coalesce(media_count.value, 0)::integer as media_count
    from public.published_contents content join selected_category category on category.id = content.category_id
    left join lateral (
      select candidate.storage_path, candidate.storage_provider, candidate.external_url from (
        select media.storage_path, media.storage_provider, media.storage_bucket, media.external_url, 0 as priority, media.sort_order from public.content_media media
        where media.id = content.cover_media_id and media.kind = 'image'
        union all
        select media.storage_path, media.storage_provider, media.storage_bucket, media.external_url, 1, media.sort_order from public.content_media media
        where media.content_id = content.id and media.kind = 'image' and coalesce(media.media_role, 'content') = 'content'
      ) candidate where candidate.external_url is not null
        or (candidate.storage_provider = 'tencent_cos' and candidate.storage_bucket = 'maplestorynk-media-1331200863' and candidate.storage_path is not null)
        or (coalesce(candidate.storage_provider, 'supabase') = 'supabase' and candidate.storage_bucket = 'maplestorynk-public' and candidate.storage_path is not null)
      order by candidate.priority, candidate.sort_order limit 1
    ) cover on true
    left join lateral (select count(*) as value from public.content_media media where media.content_id = content.id and coalesce(media.media_role, 'content') = 'content' and (
      (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863' and media.storage_path is not null)
      or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public' and media.storage_path is not null)
      or media.external_url is not null or (media.video_provider = 'tencent_vod' and media.provider_file_id is not null))) media_count on true
    order by content.sort_order, content.published_at desc, content.id offset greatest(page_offset, 0) limit least(greatest(page_limit, 1), 50)
  )
  select jsonb_build_object('category', (select to_jsonb(selected_category) from selected_category), 'items', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
    'total', (select count(*) from public.published_contents content join selected_category category on category.id = content.category_id));
$$;
revoke all on function public.get_public_category(text, integer, integer) from public;
grant execute on function public.get_public_category(text, integer, integer) to anon, authenticated;

create or replace function public.get_public_home()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', coalesce((select to_jsonb(settings) from public.site_settings settings where settings.id = 'main'), '{}'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order) from (
      select category.id, category.slug, category.name, category.description, category.image_path, category.image_provider, category.sort_order, category.is_visible,
        count(content.id)::integer as content_count, coalesce(first_media.storage_path, '') as first_media_path,
        coalesce(first_media.storage_provider, 'supabase') as first_media_provider
      from public.categories category left join public.published_contents content on content.category_id = category.id
      left join lateral (
        select candidate.storage_path, candidate.storage_provider from public.published_contents source_content
        join lateral (
          select media.storage_path, media.storage_provider from (
            select selected.storage_path, selected.storage_provider, selected.storage_bucket, 0 as priority, selected.sort_order from public.content_media selected where selected.id = source_content.cover_media_id and selected.kind = 'image'
            union all
            select fallback.storage_path, fallback.storage_provider, fallback.storage_bucket, 1, fallback.sort_order from public.content_media fallback where fallback.content_id = source_content.id and fallback.kind = 'image' and coalesce(fallback.media_role, 'content') = 'content'
          ) media where (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863' and media.storage_path is not null)
            or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public' and media.storage_path is not null)
          order by media.priority, media.sort_order limit 1
        ) candidate on true
        where source_content.category_id = category.id order by source_content.sort_order limit 1
      ) first_media on true
      where category.is_visible = true group by category.id, first_media.storage_path, first_media.storage_provider
    ) row_data), '[]'::jsonb),
    'carousel', coalesce((select jsonb_agg(to_jsonb(carousel) order by carousel.sort_order) from public.carousel_slides carousel where carousel.is_visible = true), '[]'::jsonb),
    'backend_mode', 'structured'
  );
$$;
revoke all on function public.get_public_home() from public;
grant execute on function public.get_public_home() to anon, authenticated;

drop view if exists public.admin_content_list;
create view public.admin_content_list
with (security_invoker = true) as
select content.id, content.slug, content.category_id, category.slug as category_slug, category.name as category_name,
  content.title, content.summary, content.status, content.is_featured, content.sort_order, content.version, content.created_by,
  content.created_at, content.updated_at, content.published_at, content.cover_media_id,
  coalesce(media_counts.media_count, 0)::integer as media_count,
  coalesce(attachment_counts.attachment_count, 0)::integer as attachment_count,
  coalesce(cover.storage_bucket, case when category.image_path is not null then case when category.image_provider = 'tencent_cos' then 'maplestorynk-media-1331200863' else 'maplestorynk-public' end end) as cover_bucket,
  coalesce(cover.storage_path, category.image_path) as cover_path, cover.external_url as cover_external_url,
  coalesce(cover.storage_provider, category.image_provider, 'supabase') as cover_provider,
  coalesce(pending_counts.pending_media_count, 0)::integer as pending_media_count
from public.contents content join public.categories category on category.id = content.category_id
left join lateral (select count(*) as media_count from public.content_media media where media.content_id = content.id and coalesce(media.media_role, 'content') = 'content') media_counts on true
left join lateral (select count(*) as attachment_count from public.attachments attachment where attachment.content_id = content.id) attachment_counts on true
left join lateral (
  select candidate.storage_provider, candidate.storage_bucket, candidate.storage_path, candidate.external_url from (
    select media.storage_provider, media.storage_bucket, media.storage_path, media.external_url, 0 as priority, media.sort_order from public.content_media media where media.id = content.cover_media_id and media.kind = 'image'
    union all
    select media.storage_provider, media.storage_bucket, media.storage_path, media.external_url, 1, media.sort_order from public.content_media media where media.content_id = content.id and media.kind = 'image' and coalesce(media.media_role, 'content') = 'content'
  ) candidate order by candidate.priority, candidate.sort_order limit 1
) cover on true
left join lateral (select count(*) as pending_media_count from public.content_media media where media.content_id = content.id and media.storage_path is not null and not (
  (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863')
  or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public'))) pending_counts on true;
revoke all on public.admin_content_list from public, anon;
grant select on public.admin_content_list to authenticated;
