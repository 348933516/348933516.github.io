-- Keep draft COS objects private until publish-content promotes them, and use
-- the category image as a stable card fallback when a content item has no image.

create or replace function public.get_public_content(content_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  with selected_content as (select * from public.published_contents where slug = content_slug limit 1),
  selected_category as (
    select category.* from public.categories category
    join selected_content content on content.category_id = category.id
    limit 1
  )
  select case when not exists(select 1 from selected_content) then null else jsonb_build_object(
    'content', (select to_jsonb(selected_content) from selected_content),
    'media', coalesce((
      select jsonb_agg(to_jsonb(media) order by media.sort_order)
      from public.content_media media
      join selected_content content on content.id = media.content_id
      where media.source_import_id is null and (
        (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863' and media.storage_path is not null)
        or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public' and media.storage_path is not null)
        or media.external_url is not null
        or (media.video_provider = 'tencent_vod' and media.provider_file_id is not null)
      )
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(to_jsonb(attachment) order by attachment.sort_order)
      from public.attachments attachment
      join selected_content content on content.id = attachment.content_id
      where (attachment.storage_provider = 'tencent_cos' and attachment.storage_bucket = 'maplestorynk-media-1331200863' and attachment.storage_path is not null)
        or (coalesce(attachment.storage_provider, 'supabase') = 'supabase' and attachment.storage_bucket = 'maplestorynk-public' and attachment.storage_path is not null)
        or attachment.external_url is not null
    ), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(tag.name order by tag.name) from public.content_tags content_tag join public.tags tag on tag.id = content_tag.tag_id join selected_content content on content.id = content_tag.content_id), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(to_jsonb(sibling) order by sibling.sort_order) from (
      select content.id, content.slug, content.category_id, content.category_slug, content.category_name, content.title, content.summary,
        content.is_featured, content.sort_order, content.version, content.created_at, content.updated_at, content.published_at,
        coalesce(category.image_path, '')::text as cover_path,
        coalesce(category.image_provider, 'supabase')::text as cover_provider,
        0::integer as media_count
      from public.published_contents content
      join selected_content selected on selected.category_id = content.category_id
      join selected_category category on category.id = content.category_id
    ) sibling), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_public_content(text) from public;
grant execute on function public.get_public_content(text) to anon, authenticated;

create or replace function public.get_public_category(category_slug text, page_offset integer default 0, page_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  with selected_category as (
    select id, slug, name, description, image_path, image_provider, sort_order, is_visible
    from public.categories where slug = category_slug and is_visible = true limit 1
  ), rows as (
    select content.id, content.slug, content.category_id, content.category_slug, content.category_name, content.title, content.summary,
      content.is_featured, content.sort_order, content.version, content.created_at, content.updated_at, content.published_at,
      coalesce(cover.storage_path, category.image_path, '') as cover_path,
      coalesce(cover.storage_provider, category.image_provider, 'supabase') as cover_provider,
      coalesce(media_count.value, 0)::integer as media_count
    from public.published_contents content
    join selected_category category on category.id = content.category_id
    left join lateral (
      select media.storage_path, media.storage_provider from public.content_media media
      where media.content_id = content.id and media.kind = 'image' and media.storage_path is not null and (
        (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863')
        or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public')
      )
      order by media.sort_order limit 1
    ) cover on true
    left join lateral (
      select count(*) as value from public.content_media media
      where media.content_id = content.id and (
        (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863' and media.storage_path is not null)
        or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public' and media.storage_path is not null)
        or media.external_url is not null
        or (media.video_provider = 'tencent_vod' and media.provider_file_id is not null)
      )
    ) media_count on true
    order by content.sort_order, content.published_at desc, content.id
    offset greatest(page_offset, 0) limit least(greatest(page_limit, 1), 50)
  )
  select jsonb_build_object(
    'category', (select to_jsonb(selected_category) from selected_category),
    'items', coalesce((select jsonb_agg(to_jsonb(rows)) from rows), '[]'::jsonb),
    'total', (select count(*) from public.published_contents content join selected_category category on category.id = content.category_id)
  );
$$;

revoke all on function public.get_public_category(text, integer, integer) from public;
grant execute on function public.get_public_category(text, integer, integer) to anon, authenticated;

create or replace function public.get_public_home()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', coalesce((select to_jsonb(settings) from public.site_settings settings where settings.id = 'main'), '{}'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.sort_order) from (
      select category.id, category.slug, category.name, category.description, category.image_path, category.image_provider, category.sort_order, category.is_visible,
        count(content.id)::integer as content_count,
        coalesce(first_media.storage_path, '') as first_media_path,
        coalesce(first_media.storage_provider, 'supabase') as first_media_provider
      from public.categories category
      left join public.published_contents content on content.category_id = category.id
      left join lateral (
        select media.storage_path, media.storage_provider from public.content_media media
        join public.contents source_content on source_content.id = media.content_id
        where source_content.category_id = category.id and source_content.status = 'published' and media.kind = 'image' and media.storage_path is not null and (
          (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863')
          or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public')
        )
        order by source_content.sort_order, media.sort_order limit 1
      ) first_media on true
      where category.is_visible = true
      group by category.id, first_media.storage_path, first_media.storage_provider
    ) row_data), '[]'::jsonb),
    'carousel', coalesce((select jsonb_agg(to_jsonb(carousel) order by carousel.sort_order) from public.carousel_slides carousel where carousel.is_visible = true), '[]'::jsonb),
    'backend_mode', 'structured'
  );
$$;

revoke all on function public.get_public_home() from public;
grant execute on function public.get_public_home() to anon, authenticated;

create or replace view public.admin_content_list
with (security_invoker = true) as
select content.id, content.slug, content.category_id, category.slug as category_slug, category.name as category_name,
  content.title, content.summary, content.status, content.is_featured, content.sort_order, content.version, content.created_by,
  content.created_at, content.updated_at, content.published_at,
  coalesce(media_counts.media_count, 0)::integer as media_count,
  coalesce(attachment_counts.attachment_count, 0)::integer as attachment_count,
  coalesce(cover.storage_bucket, case when category.image_path is not null then case when category.image_provider = 'tencent_cos' then 'maplestorynk-media-1331200863' else 'maplestorynk-public' end end) as cover_bucket,
  coalesce(cover.storage_path, category.image_path) as cover_path,
  cover.external_url as cover_external_url,
  coalesce(cover.storage_provider, category.image_provider, 'supabase') as cover_provider,
  coalesce(pending_counts.pending_media_count, 0)::integer as pending_media_count
from public.contents content
join public.categories category on category.id = content.category_id
left join lateral (select count(*) as media_count from public.content_media media where media.content_id = content.id) media_counts on true
left join lateral (select count(*) as attachment_count from public.attachments attachment where attachment.content_id = content.id) attachment_counts on true
left join lateral (
  select media.storage_provider, media.storage_bucket, media.storage_path, media.external_url
  from public.content_media media where media.content_id = content.id and media.kind = 'image'
  order by media.sort_order, media.created_at limit 1
) cover on true
left join lateral (
  select count(*) as pending_media_count from (
    select media.id from public.content_media media
    where media.content_id = content.id and media.storage_path is not null and not (
      (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863')
      or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public')
    )
    union all
    select attachment.id from public.attachments attachment
    where attachment.content_id = content.id and attachment.storage_path is not null and not (
      (attachment.storage_provider = 'tencent_cos' and attachment.storage_bucket = 'maplestorynk-media-1331200863')
      or (coalesce(attachment.storage_provider, 'supabase') = 'supabase' and attachment.storage_bucket = 'maplestorynk-public')
    )
  ) pending
) pending_counts on true;

revoke all on public.admin_content_list from public, anon;
grant select on public.admin_content_list to authenticated;
