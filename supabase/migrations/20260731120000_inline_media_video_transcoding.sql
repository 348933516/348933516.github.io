-- Inline media placement and a recoverable single-worker video transcode queue.

alter table public.content_media add column if not exists placement_status text not null default 'unplaced';
alter table public.content_media add column if not exists poster_storage_path text;
alter table public.content_media add column if not exists pending_storage_provider text;
alter table public.content_media add column if not exists pending_storage_bucket text;
alter table public.content_media add column if not exists pending_storage_path text;
alter table public.content_media add column if not exists pending_mime_type text;
alter table public.content_media add column if not exists pending_size_bytes bigint;
alter table public.content_media add column if not exists pending_width integer;
alter table public.content_media add column if not exists pending_height integer;

do $$ begin
  alter table public.content_media add constraint content_media_placement_status_check
    check (placement_status in ('unplaced', 'inserted'));
exception when duplicate_object then null; end $$;

create table if not exists public.video_transcode_jobs (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.content_media(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'transcoding', 'uploading', 'verifying', 'completed', 'failed', 'cancelled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  input_provider text not null default 'tencent_cos' check (input_provider in ('supabase', 'tencent_cos')),
  input_bucket text not null,
  input_path text not null,
  output_bucket text not null,
  output_path text not null,
  poster_path text not null,
  input_size_bytes bigint not null default 0,
  output_size_bytes bigint,
  input_codec text,
  output_codec text,
  duration_ms integer,
  attempt_count integer not null default 0,
  worker_id text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists video_transcode_jobs_active_media_idx
  on public.video_transcode_jobs(media_id)
  where status in ('queued', 'claimed', 'transcoding', 'uploading', 'verifying');
create index if not exists video_transcode_jobs_claim_idx
  on public.video_transcode_jobs(status, created_at)
  where status in ('queued', 'claimed', 'transcoding', 'uploading', 'verifying');

alter table public.video_transcode_jobs enable row level security;
revoke all on public.video_transcode_jobs from anon, authenticated;
grant select, insert, update, delete on public.video_transcode_jobs to service_role;

create or replace function public.sync_content_media_placement()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.content_media media set placement_status = case
    when position('data-media-id="' || media.id::text || '"' in new.body_html) > 0
      or position('data-media-id=''' || media.id::text || '''' in new.body_html) > 0
    then 'inserted' else 'unplaced' end
  where media.content_id = new.id;
  return new;
end;
$$;
drop trigger if exists contents_sync_media_placement on public.contents;
create trigger contents_sync_media_placement
after insert or update of body_html on public.contents
for each row execute function public.sync_content_media_placement();

create or replace function public.claim_video_transcode_job(p_worker_id text)
returns setof public.video_transcode_jobs
language plpgsql security definer set search_path = public
as $$
declare
  selected_id uuid;
begin
  select job.id into selected_id
  from public.video_transcode_jobs job
  where job.status = 'queued'
     or (job.status in ('claimed', 'transcoding', 'uploading', 'verifying') and job.lease_expires_at < now())
  order by job.created_at
  for update skip locked
  limit 1;
  if selected_id is null then return; end if;
  return query
  update public.video_transcode_jobs job set
    status = 'claimed', worker_id = left(p_worker_id, 120),
    lease_expires_at = now() + interval '3 minutes', heartbeat_at = now(),
    attempt_count = job.attempt_count + 1, error_code = null, error_message = null,
    updated_at = now()
  where job.id = selected_id
  returning job.*;
end;
$$;
revoke all on function public.claim_video_transcode_job(text) from public;
grant execute on function public.claim_video_transcode_job(text) to service_role;

-- Existing non-Word media used to be rendered independently. Place it once at
-- the end of the body so the visual order survives the inline-only upgrade.
with missing as (
  select media.content_id,
    string_agg(
      case when media.kind = 'video' then
        '<figure data-media-id="' || media.id::text || '" data-media-kind="video"><video controls preload="metadata" playsinline></video><figcaption data-placeholder="视频说明">' ||
        replace(replace(replace(coalesce(nullif(media.note, ''), media.title), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</figcaption></figure>'
      else
        '<figure data-media-id="' || media.id::text || '" data-media-kind="image" data-editor-image="true"><img alt="' ||
        replace(replace(replace(coalesce(nullif(media.alt_text, ''), media.title), '&', '&amp;'), '"', '&quot;'), '<', '&lt;') ||
        '"><figcaption data-placeholder="图片说明">' ||
        replace(replace(replace(coalesce(nullif(media.note, ''), media.title), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</figcaption></figure>'
      end,
      '' order by media.sort_order, media.created_at, media.id
    ) as figures
  from public.content_media media
  join public.contents content on content.id = media.content_id
  where media.source_import_id is null
    and position('data-media-id="' || media.id::text || '"' in content.body_html) = 0
  group by media.content_id
)
update public.contents content
set body_html = content.body_html || missing.figures,
    body_text = trim(content.body_text || ' 媒体'),
    updated_at = content.updated_at
from missing where content.id = missing.content_id;

update public.content_media media set placement_status = 'inserted'
from public.contents content
where content.id = media.content_id
  and position('data-media-id="' || media.id::text || '"' in content.body_html) > 0;

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
  update public.contents as published_content set status = 'published', updated_by = p_actor_id
  where published_content.id = p_content_id and published_content.version = p_expected_version
  returning published_content.* into target;
  if not found then raise exception 'VERSION_CONFLICT'; end if;
  return query select target.id, target.version, target.status::text, target.published_at;
end;
$$;
revoke all on function public.commit_content_publication(uuid, integer, uuid, jsonb) from public;
grant execute on function public.commit_content_publication(uuid, integer, uuid, jsonb) to service_role;
