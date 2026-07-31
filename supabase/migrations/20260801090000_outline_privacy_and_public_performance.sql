-- Per-content public outlines, private attachments, and smaller public shell reads.

alter table public.contents add column if not exists outline_enabled boolean not null default false;
alter table public.contents add column if not exists outline_settings jsonb not null default '{"title":"文章大纲","headingGroupLabel":"正文","mediaGroupLabel":"图片目录","labels":{}}'::jsonb;

create or replace function public.clean_content_outline_settings()
returns trigger language plpgsql set search_path = public as $$
declare cleaned_labels jsonb;
begin
  select coalesce(jsonb_object_agg(label.key, label.value), '{}'::jsonb) into cleaned_labels
  from jsonb_each(coalesce(new.outline_settings->'labels', '{}'::jsonb)) label
  where position(split_part(label.key, ':', 1) in new.body_html) > 0;
  new.outline_settings = jsonb_build_object(
    'title', coalesce(nullif(new.outline_settings->>'title', ''), '文章大纲'),
    'headingGroupLabel', coalesce(nullif(new.outline_settings->>'headingGroupLabel', ''), '正文'),
    'mediaGroupLabel', coalesce(nullif(new.outline_settings->>'mediaGroupLabel', ''), '图片目录'),
    'labels', cleaned_labels
  );
  return new;
end;
$$;
drop trigger if exists contents_clean_outline_settings on public.contents;
create trigger contents_clean_outline_settings before insert or update of body_html, outline_settings on public.contents
for each row execute function public.clean_content_outline_settings();

create or replace view public.published_contents
with (security_barrier = true) as
select
  content.id,
  content.category_id,
  content.slug,
  content.title,
  content.summary,
  content.body_html,
  content.body_text,
  content.is_featured,
  content.sort_order,
  content.version,
  content.published_at,
  content.created_at,
  content.updated_at,
  category.slug as category_slug,
  category.name as category_name,
  content.outline_enabled,
  content.outline_settings
from public.contents content
join public.categories category on category.id = content.category_id
where content.status = 'published' and content.deleted_at is null and category.is_visible = true;

revoke all on public.published_contents from public;
grant select on public.published_contents to anon, authenticated;

create or replace function public.get_public_shell()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', coalesce((select to_jsonb(settings) from public.site_settings settings where settings.id = 'main'), '{}'::jsonb),
    'backend_mode', 'structured'
  );
$$;
revoke all on function public.get_public_shell() from public;
grant execute on function public.get_public_shell() to anon, authenticated;

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

revoke select on public.attachments from anon;
drop policy if exists attachments_read on public.attachments;
create policy attachments_read on public.attachments for select to authenticated
using (public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]));

create or replace function public.reorder_carousel_slides(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  if not public.has_any_role(array['super_admin','editor']::public.app_role[]) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) > 100 then raise exception 'INVALID_ITEMS'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    update public.carousel_slides set sort_order = greatest(10, least(100000, coalesce((item->>'sortOrder')::integer, 100))), updated_by = auth.uid()
    where id = (item->>'id')::uuid;
    if not found then raise exception 'SLIDE_NOT_FOUND'; end if;
  end loop;
end;
$$;
revoke all on function public.reorder_carousel_slides(jsonb) from public;
grant execute on function public.reorder_carousel_slides(jsonb) to authenticated;

create table if not exists public.attachment_privacy_jobs (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null unique references public.attachments(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','copying','verified','cleanup','completed','failed')),
  retry_count integer not null default 0,
  destination_path text,
  source_provider text,
  source_bucket text,
  source_path text,
  size_bytes bigint not null default 0,
  etag text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.attachment_privacy_jobs enable row level security;
revoke all on public.attachment_privacy_jobs from anon, authenticated;
grant select, insert, update, delete on public.attachment_privacy_jobs to service_role;

insert into public.attachment_privacy_jobs (attachment_id, source_provider, source_bucket, source_path, size_bytes)
select attachment.id, coalesce(attachment.storage_provider, 'supabase'), attachment.storage_bucket, attachment.storage_path, coalesce(attachment.size_bytes, 0)
from public.attachments attachment
where attachment.storage_path is not null and (
  (attachment.storage_provider = 'tencent_cos' and attachment.storage_bucket = 'maplestorynk-media-1331200863')
  or (coalesce(attachment.storage_provider, 'supabase') = 'supabase' and attachment.storage_bucket = 'maplestorynk-public')
)
on conflict (attachment_id) do nothing;

create or replace function public.commit_private_attachment(
  p_job_id uuid,
  p_attachment_id uuid,
  p_bucket text,
  p_path text,
  p_etag text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.attachments set storage_provider = 'tencent_cos', storage_bucket = p_bucket, storage_path = p_path
  where id = p_attachment_id;
  if not found then raise exception 'ATTACHMENT_NOT_FOUND'; end if;
  update public.attachment_privacy_jobs set status = 'cleanup', destination_path = p_path, etag = p_etag, error_message = null, updated_at = now()
  where id = p_job_id and attachment_id = p_attachment_id;
  if not found then raise exception 'PRIVACY_JOB_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.commit_private_attachment(uuid, uuid, text, text, text) from public;
grant execute on function public.commit_private_attachment(uuid, uuid, text, text, text) to service_role;

-- Attachments remain private and therefore are not publication-pending items.
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
  select count(*) as pending_media_count from public.content_media media
  where media.content_id = content.id and media.storage_path is not null and not (
    (media.storage_provider = 'tencent_cos' and media.storage_bucket = 'maplestorynk-media-1331200863')
    or (coalesce(media.storage_provider, 'supabase') = 'supabase' and media.storage_bucket = 'maplestorynk-public')
  )
) pending_counts on true;
revoke all on public.admin_content_list from public, anon;
grant select on public.admin_content_list to authenticated;
