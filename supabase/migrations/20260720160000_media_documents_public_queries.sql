-- Lossless document media, cloud VOD metadata, and compact public read APIs.

alter table public.content_media add column if not exists original_storage_path text;
alter table public.content_media add column if not exists display_storage_path text;
alter table public.content_media add column if not exists content_hash text;
alter table public.content_media add column if not exists original_mime_type text;
alter table public.content_media add column if not exists video_provider text;
alter table public.content_media add column if not exists provider_file_id text;
alter table public.content_media add column if not exists provider_task_id text;
alter table public.content_media add column if not exists provider_app_id bigint;
alter table public.content_media add column if not exists playback_url text;
alter table public.content_media add column if not exists poster_url text;

do $$ begin
  alter table public.content_media add constraint content_media_video_provider_check
    check (video_provider is null or video_provider in ('tencent_vod'));
exception when duplicate_object then null;
end $$;

create index if not exists content_media_hash_idx on public.content_media(content_id, content_hash) where content_hash is not null;
create index if not exists content_media_provider_idx on public.content_media(video_provider, provider_file_id) where provider_file_id is not null;

create or replace function public.get_public_home()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'settings', coalesce((select to_jsonb(s) from public.site_settings s where s.id = 'main'), '{}'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order)
      from (
        select c.id, c.slug, c.name, c.description, c.image_path, c.sort_order, c.is_visible,
          count(pc.id)::integer as content_count,
          coalesce(first_media.storage_path, '') as first_media_path
        from public.categories c
        left join public.published_contents pc on pc.category_id = c.id
        left join lateral (
          select cm.storage_path
          from public.content_media cm
          join public.contents source_content on source_content.id = cm.content_id
          where source_content.category_id = c.id and source_content.status = 'published'
            and cm.kind = 'image' and cm.storage_bucket = 'maplestorynk-public'
          order by source_content.sort_order, cm.sort_order
          limit 1
        ) first_media on true
        where c.is_visible = true
        group by c.id, first_media.storage_path
      ) row_data
    ), '[]'::jsonb),
    'carousel', coalesce((select jsonb_agg(to_jsonb(cs) order by cs.sort_order) from public.carousel_slides cs where cs.is_visible = true), '[]'::jsonb),
    'backend_mode', 'structured'
  );
$$;

create or replace function public.get_public_category(category_slug text, page_offset integer default 0, page_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_category as (
    select id, slug, name, description, image_path, sort_order, is_visible
    from public.categories where slug = category_slug and is_visible = true limit 1
  ), rows as (
    select pc.id, pc.slug, pc.category_id, pc.category_slug, pc.category_name, pc.title, pc.summary,
      pc.is_featured, pc.sort_order, pc.version, pc.created_at, pc.updated_at, pc.published_at,
      coalesce(cover.storage_path, '') as cover_path,
      coalesce(media_count.value, 0)::integer as media_count
    from public.published_contents pc
    join selected_category category on category.id = pc.category_id
    left join lateral (
      select cm.storage_path from public.content_media cm
      where cm.content_id = pc.id and cm.kind = 'image' and cm.storage_bucket = 'maplestorynk-public'
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
    'media', coalesce((select jsonb_agg(to_jsonb(cm) order by cm.sort_order) from public.content_media cm join selected_content sc on sc.id = cm.content_id), '[]'::jsonb),
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

revoke all on function public.get_public_home() from public;
revoke all on function public.get_public_category(text, integer, integer) from public;
revoke all on function public.get_public_content(text) from public;
grant execute on function public.get_public_home() to anon, authenticated;
grant execute on function public.get_public_category(text, integer, integer) to anon, authenticated;
grant execute on function public.get_public_content(text) to anon, authenticated;
