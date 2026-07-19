-- Media compatibility, lightweight admin listings, and professional logging.

alter table public.content_media add column if not exists video_codec text;
alter table public.content_media add column if not exists duration_ms integer;
alter table public.content_media add column if not exists original_size_bytes bigint;
alter table public.content_media add column if not exists processing_status text not null default 'ready';

do $$ begin
  alter table public.content_media add constraint content_media_processing_status_check
    check (processing_status in ('ready', 'processing', 'failed'));
exception when duplicate_object then null;
end $$;

create table if not exists public.release_notes (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  summary text not null default '',
  details text not null default '',
  features jsonb not null default '[]'::jsonb,
  fixes jsonb not null default '[]'::jsonb,
  optimizations jsonb not null default '[]'::jsonb,
  released_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.runtime_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  severity text not null default 'error' check (severity in ('info', 'warning', 'error')),
  source text not null,
  message text not null,
  stack text,
  route text,
  app_version text,
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists runtime_logs_created_idx on public.runtime_logs(created_at desc);
create index if not exists runtime_logs_unresolved_idx on public.runtime_logs(created_at desc) where resolved_at is null;
create index if not exists release_notes_released_idx on public.release_notes(released_at desc);

drop trigger if exists release_notes_touch on public.release_notes;
create trigger release_notes_touch before update on public.release_notes for each row execute function public.touch_updated_at();

alter table public.release_notes enable row level security;
alter table public.runtime_logs enable row level security;

grant select, insert, update, delete on public.release_notes to authenticated;
grant select, insert, update, delete on public.runtime_logs to authenticated;
grant usage, select on sequence public.runtime_logs_id_seq to authenticated;

drop policy if exists release_notes_admin_read on public.release_notes;
create policy release_notes_admin_read on public.release_notes for select to authenticated
using (public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]));
drop policy if exists release_notes_super_write on public.release_notes;
create policy release_notes_super_write on public.release_notes for all to authenticated
using (public.has_any_role(array['super_admin']::public.app_role[]))
with check (public.has_any_role(array['super_admin']::public.app_role[]));

drop policy if exists runtime_logs_admin_read on public.runtime_logs;
create policy runtime_logs_admin_read on public.runtime_logs for select to authenticated
using (public.has_any_role(array['super_admin','editor','viewer']::public.app_role[]));
drop policy if exists runtime_logs_self_insert on public.runtime_logs;
create policy runtime_logs_self_insert on public.runtime_logs for insert to authenticated
with check (
  actor_id = auth.uid()
  and public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[])
);
drop policy if exists runtime_logs_super_manage on public.runtime_logs;
create policy runtime_logs_super_manage on public.runtime_logs for update to authenticated
using (public.has_any_role(array['super_admin']::public.app_role[]))
with check (public.has_any_role(array['super_admin']::public.app_role[]));
drop policy if exists runtime_logs_super_delete on public.runtime_logs;
create policy runtime_logs_super_delete on public.runtime_logs for delete to authenticated
using (public.has_any_role(array['super_admin']::public.app_role[]));

create or replace view public.admin_content_list
with (security_invoker = true)
as
select
  c.id,
  c.slug,
  c.category_id,
  cat.slug as category_slug,
  cat.name as category_name,
  c.title,
  c.summary,
  c.status,
  c.is_featured,
  c.sort_order,
  c.version,
  c.created_by,
  c.created_at,
  c.updated_at,
  c.published_at,
  coalesce(media_counts.media_count, 0)::integer as media_count,
  coalesce(attachment_counts.attachment_count, 0)::integer as attachment_count,
  cover.storage_bucket as cover_bucket,
  cover.storage_path as cover_path,
  cover.external_url as cover_external_url
from public.contents c
join public.categories cat on cat.id = c.category_id
left join lateral (
  select count(*) as media_count from public.content_media cm where cm.content_id = c.id
) media_counts on true
left join lateral (
  select count(*) as attachment_count from public.attachments a where a.content_id = c.id
) attachment_counts on true
left join lateral (
  select cm.storage_bucket, cm.storage_path, cm.external_url
  from public.content_media cm
  where cm.content_id = c.id and cm.kind = 'image'
  order by cm.sort_order, cm.created_at
  limit 1
) cover on true;

revoke all on public.admin_content_list from public, anon;
grant select on public.admin_content_list to authenticated;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id text;
  actor_text text;
  actor_name text;
  actor_email text;
  actor_role text;
  category_name text;
  old_data jsonb := coalesce(to_jsonb(old), '{}'::jsonb);
  new_data jsonb := coalesce(to_jsonb(new), '{}'::jsonb);
  changed_fields jsonb := '[]'::jsonb;
  audit_metadata jsonb;
begin
  row_id = coalesce(new_data->>'id', old_data->>'id', 'unknown');
  actor_text = coalesce(auth.uid()::text, new_data->>'updated_by', new_data->>'created_by', old_data->>'updated_by', old_data->>'created_by');
  if nullif(actor_text, '') is not null then
    select p.display_name, p.email, p.role::text into actor_name, actor_email, actor_role
    from public.profiles p where p.id = actor_text::uuid;
  end if;
  if coalesce(new_data->>'category_id', old_data->>'category_id') is not null then
    select c.name into category_name from public.categories c
    where c.id = coalesce(new_data->>'category_id', old_data->>'category_id')::uuid;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
      into changed_fields
    from jsonb_object_keys(new_data) key
    where old_data->key is distinct from new_data->key
      and key not in ('body_html','body_json','body_text','search_text','updated_at');
  end if;

  audit_metadata = jsonb_strip_nulls(jsonb_build_object(
    'title', coalesce(new_data->>'title', new_data->>'name', old_data->>'title', old_data->>'name'),
    'actor_name', actor_name,
    'actor_email', actor_email,
    'actor_role', actor_role,
    'category_name', category_name,
    'kind', coalesce(new_data->>'kind', old_data->>'kind'),
    'mime_type', coalesce(new_data->>'mime_type', old_data->>'mime_type'),
    'size_bytes', coalesce(new_data->'size_bytes', old_data->'size_bytes'),
    'width', coalesce(new_data->'width', old_data->'width'),
    'height', coalesce(new_data->'height', old_data->'height'),
    'duration_ms', coalesce(new_data->'duration_ms', old_data->'duration_ms'),
    'video_codec', coalesce(new_data->>'video_codec', old_data->>'video_codec'),
    'status_before', old_data->>'status',
    'status_after', new_data->>'status',
    'changed_fields', changed_fields,
    'version', coalesce(new_data->'version', old_data->'version')
  ));

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (nullif(actor_text, '')::uuid, upper(tg_op), tg_table_name, row_id, audit_metadata);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

insert into public.release_notes(version, title, summary, details, features, fixes, optimizations)
values (
  '2.1.0',
  '稳定性与后台日志升级',
  '视频兼容、文档导入、表格样式、删除响应和日志中心升级。',
  '本版本集中修复后台高频使用问题，并补充可追踪的运行与操作记录。',
  '["不兼容视频自动检测与转换", "四类后台日志中心"]'::jsonb,
  '["Word/Excel 模块加载失败", "表格边框样式不生效", "视频有时长但黑屏"]'::jsonb,
  '["内容列表轻量查询", "删除即时反馈", "媒体清理后台执行"]'::jsonb
)
on conflict (version) do nothing;
