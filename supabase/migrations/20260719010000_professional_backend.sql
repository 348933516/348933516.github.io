-- MapleStoryNK professional backend.
-- Apply only after exporting public.site_state. The legacy table is retained read-only.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$ begin
  create type public.app_role as enum ('super_admin', 'editor', 'uploader', 'viewer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.profile_status as enum ('invited', 'active', 'disabled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.content_status as enum ('draft', 'published', 'hidden', 'trashed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.media_kind as enum ('image', 'video');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role public.app_role not null default 'viewer',
  status public.profile_status not null default 'invited',
  invited_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists updated_by uuid references auth.users(id);

create table if not exists public.site_settings (
  id text primary key default 'main' check (id = 'main'),
  migration_completed boolean not null default false,
  brand_title text not null default 'MapleStoryNK',
  brand_subtitle text not null default '业务与地图资料中心',
  hero_title text not null default 'MapleStoryNK',
  hero_subtitle text not null default '',
  category_title text not null default '类目展示',
  category_subtitle text not null default '',
  top_logo_path text,
  hero_logo_path text,
  page_background_path text,
  hero_background_path text,
  tile_background_path text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.site_settings add column if not exists migration_completed boolean not null default false;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  description text not null default '',
  image_path text,
  sort_order integer not null default 100,
  is_visible boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contents (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  category_id uuid not null references public.categories(id),
  slug text not null unique,
  title text not null,
  summary text not null default '',
  body_json jsonb not null default '{}'::jsonb,
  body_html text not null default '',
  body_text text not null default '',
  source_record text not null default '',
  status public.content_status not null default 'draft',
  is_featured boolean not null default false,
  sort_order integer not null default 100,
  version integer not null default 1,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  published_at timestamptz,
  scheduled_for timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text not null default ''
);

create table if not exists public.content_media (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete cascade,
  kind public.media_kind not null default 'image',
  storage_bucket text,
  storage_path text,
  external_url text,
  title text not null default '',
  note text not null default '',
  hierarchy_path text[] not null default '{}',
  alt_text text not null default '',
  width integer,
  height integer,
  mime_type text,
  size_bytes bigint,
  sort_order integer not null default 100,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint content_media_source check (
    (storage_bucket is not null and storage_path is not null and external_url is null)
    or (external_url ~ '^https://' and storage_bucket is null and storage_path is null)
  )
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete cascade,
  name text not null,
  storage_bucket text,
  storage_path text,
  external_url text,
  mime_type text,
  size_bytes bigint,
  sort_order integer not null default 100,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint attachment_source check (
    (storage_bucket is not null and storage_path is not null and external_url is null)
    or (external_url ~ '^https://' and storage_bucket is null and storage_path is null)
  )
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.content_tags (
  content_id uuid not null references public.contents(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (content_id, tag_id)
);

create table if not exists public.content_revisions (
  id bigint generated always as identity primary key,
  content_id uuid not null references public.contents(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (content_id, version)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists contents_category_order_idx on public.contents(category_id, sort_order);
create index if not exists contents_public_idx on public.contents(status, published_at desc) where deleted_at is null;
create index if not exists contents_search_trgm_idx on public.contents using gin(search_text gin_trgm_ops);
create index if not exists content_media_order_idx on public.content_media(content_id, sort_order);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace view public.published_contents
with (security_barrier = true)
as
select
  c.id,
  c.category_id,
  c.slug,
  c.title,
  c.summary,
  c.body_html,
  c.body_text,
  c.is_featured,
  c.sort_order,
  c.version,
  c.published_at,
  c.created_at,
  c.updated_at,
  cat.slug as category_slug,
  cat.name as category_name
from public.contents c
join public.categories cat on cat.id = c.category_id
where c.status = 'published' and c.deleted_at is null and cat.is_visible = true;

revoke all on public.contents from anon;
revoke all on public.published_contents from public;
grant select on public.published_contents to anon, authenticated;
revoke insert, update, delete on public.contents from authenticated;
grant select on public.contents to authenticated;
grant select on public.site_settings, public.categories, public.content_media, public.attachments, public.tags, public.content_tags to anon, authenticated;
grant insert, update, delete on public.site_settings, public.categories, public.content_media, public.attachments, public.tags, public.content_tags to authenticated;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant select on public.content_revisions, public.audit_logs to authenticated;

insert into public.site_settings (id) values ('main') on conflict (id) do nothing;

create or replace function public.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.has_any_role(allowed public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = any(allowed), false);
$$;

create or replace function public.is_published_content(target_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.contents
    where id = target_content_id and status = 'published' and deleted_at is null
  );
$$;

create or replace function public.is_owned_draft_content(target_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.contents
    where id = target_content_id
      and status = 'draft'
      and deleted_at is null
      and created_by = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prepare_content_write()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published'
    and (tg_op = 'INSERT' or old.status is distinct from 'published')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Publishing must use the publish-content function';
  end if;
  new.updated_at = now();
  new.search_text = concat_ws(' ', new.title, new.summary, new.body_text);
  if tg_op = 'UPDATE' then
    new.version = old.version + 1;
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at = coalesce(new.published_at, now());
  end if;
  if new.status = 'trashed' then
    new.deleted_at = coalesce(new.deleted_at, now());
  elsif tg_op = 'UPDATE' and old.status = 'trashed' then
    new.deleted_at = null;
  end if;
  return new;
end;
$$;

create or replace function public.capture_content_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.content_revisions(content_id, version, snapshot, created_by)
  values (old.id, old.version, to_jsonb(old), coalesce(new.updated_by, auth.uid()))
  on conflict (content_id, version) do nothing;
  return new;
end;
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id text;
  actor_text text;
begin
  row_id = coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'), 'unknown');
  actor_text = coalesce(auth.uid()::text, to_jsonb(new)->>'updated_by', to_jsonb(new)->>'created_by');
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (nullif(actor_text, '')::uuid, lower(tg_op), tg_table_name, row_id, jsonb_build_object('version', coalesce(to_jsonb(new)->>'version', to_jsonb(old)->>'version')));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.site_settings;
create trigger settings_touch before update on public.site_settings for each row execute function public.touch_updated_at();
drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();
drop trigger if exists contents_prepare on public.contents;
create trigger contents_prepare before insert or update on public.contents for each row execute function public.prepare_content_write();
drop trigger if exists contents_revision on public.contents;
create trigger contents_revision before update on public.contents for each row execute function public.capture_content_revision();

do $$
declare table_name text;
begin
  foreach table_name in array array['site_settings','categories','contents','content_media','attachments','profiles'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_audit', table_name);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', table_name || '_audit', table_name);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.site_settings enable row level security;
alter table public.categories enable row level security;
alter table public.contents enable row level security;
alter table public.content_media enable row level security;
alter table public.attachments enable row level security;
alter table public.tags enable row level security;
alter table public.content_tags enable row level security;
alter table public.content_revisions enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id = auth.uid() or public.has_any_role(array['super_admin']::public.app_role[]));
drop policy if exists profiles_super_write on public.profiles;
create policy profiles_super_write on public.profiles for all to authenticated
using (public.has_any_role(array['super_admin']::public.app_role[]))
with check (public.has_any_role(array['super_admin']::public.app_role[]));

drop policy if exists settings_public_read on public.site_settings;
create policy settings_public_read on public.site_settings for select to anon, authenticated using (true);
drop policy if exists settings_super_write on public.site_settings;
create policy settings_super_write on public.site_settings for update to authenticated
using (public.has_any_role(array['super_admin']::public.app_role[]))
with check (public.has_any_role(array['super_admin']::public.app_role[]));

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories for select to anon, authenticated
using (is_visible or public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]));
drop policy if exists categories_editor_write on public.categories;
create policy categories_editor_write on public.categories for all to authenticated
using (public.has_any_role(array['super_admin','editor']::public.app_role[]))
with check (public.has_any_role(array['super_admin','editor']::public.app_role[]));

drop policy if exists contents_public_read on public.contents;
create policy contents_public_read on public.contents for select to anon, authenticated
using ((status = 'published' and deleted_at is null) or public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]));
drop policy if exists contents_create on public.contents;
create policy contents_create on public.contents for insert to authenticated
with check (
  public.has_any_role(array['super_admin','editor','uploader']::public.app_role[])
  and created_by = auth.uid()
  and (public.current_profile_role() <> 'uploader' or status = 'draft')
);
drop policy if exists contents_update on public.contents;
create policy contents_update on public.contents for update to authenticated
using (
  public.has_any_role(array['super_admin','editor']::public.app_role[])
  or (public.current_profile_role() = 'uploader' and created_by = auth.uid() and status = 'draft')
)
with check (
  public.has_any_role(array['super_admin','editor']::public.app_role[])
  or (public.current_profile_role() = 'uploader' and created_by = auth.uid() and status = 'draft')
);
drop policy if exists contents_super_delete on public.contents;
create policy contents_super_delete on public.contents for delete to authenticated
using (public.has_any_role(array['super_admin']::public.app_role[]));

drop policy if exists media_read on public.content_media;
create policy media_read on public.content_media for select to anon, authenticated
using (
  (public.is_published_content(content_id) and (storage_bucket = 'maplestorynk-public' or external_url is not null))
  or public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[])
);
drop policy if exists media_write on public.content_media;
create policy media_write on public.content_media for all to authenticated
using (
  public.has_any_role(array['super_admin','editor']::public.app_role[])
  or (public.current_profile_role() = 'uploader' and public.is_owned_draft_content(content_id))
)
with check (
  public.has_any_role(array['super_admin','editor']::public.app_role[])
  or (public.current_profile_role() = 'uploader' and public.is_owned_draft_content(content_id))
);

drop policy if exists attachments_read on public.attachments;
create policy attachments_read on public.attachments for select to anon, authenticated
using (
  (public.is_published_content(content_id) and (storage_bucket = 'maplestorynk-public' or external_url is not null))
  or public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[])
);
drop policy if exists attachments_write on public.attachments;
create policy attachments_write on public.attachments for all to authenticated
using (
  public.has_any_role(array['super_admin','editor']::public.app_role[])
  or (public.current_profile_role() = 'uploader' and public.is_owned_draft_content(content_id))
)
with check (
  public.has_any_role(array['super_admin','editor']::public.app_role[])
  or (public.current_profile_role() = 'uploader' and public.is_owned_draft_content(content_id))
);

drop policy if exists tags_public_read on public.tags;
create policy tags_public_read on public.tags for select to anon, authenticated using (true);
drop policy if exists tags_editor_write on public.tags;
create policy tags_editor_write on public.tags for all to authenticated
using (public.has_any_role(array['super_admin','editor']::public.app_role[]))
with check (public.has_any_role(array['super_admin','editor']::public.app_role[]));
drop policy if exists content_tags_public_read on public.content_tags;
create policy content_tags_public_read on public.content_tags for select to anon, authenticated
using (
  public.is_published_content(content_id)
  or public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[])
);
drop policy if exists content_tags_editor_write on public.content_tags;
create policy content_tags_editor_write on public.content_tags for all to authenticated
using (public.has_any_role(array['super_admin','editor']::public.app_role[]))
with check (public.has_any_role(array['super_admin','editor']::public.app_role[]));

drop policy if exists revisions_admin_read on public.content_revisions;
create policy revisions_admin_read on public.content_revisions for select to authenticated
using (public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]));
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs for select to authenticated
using (public.has_any_role(array['super_admin','editor','viewer']::public.app_role[]));

-- Promote the existing owner account. Change the email before running if ownership changes.
insert into public.profiles(id, email, display_name, role, status)
select id, email, coalesce(raw_user_meta_data->>'username', email), 'super_admin', 'active'
from auth.users where lower(email) = lower('348933516@qq.com')
on conflict (id) do update set role = 'super_admin', status = 'active', email = excluded.email;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('maplestorynk-public', 'maplestorynk-public', true, 104857600, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),
  ('maplestorynk-private', 'maplestorynk-private', false, 104857600, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','application/pdf','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists maplestorynk_public_read on storage.objects;
create policy maplestorynk_public_read on storage.objects for select to anon, authenticated
using (bucket_id = 'maplestorynk-public');
drop policy if exists maplestorynk_public_admin_write on storage.objects;
create policy maplestorynk_public_admin_write on storage.objects for all to authenticated
using (bucket_id = 'maplestorynk-public' and public.has_any_role(array['super_admin','editor']::public.app_role[]))
with check (bucket_id = 'maplestorynk-public' and public.has_any_role(array['super_admin','editor']::public.app_role[]));
drop policy if exists maplestorynk_private_admin_read on storage.objects;
create policy maplestorynk_private_admin_read on storage.objects for select to authenticated
using (bucket_id = 'maplestorynk-private' and public.has_any_role(array['super_admin','editor','uploader','viewer']::public.app_role[]));
drop policy if exists maplestorynk_private_write on storage.objects;
create policy maplestorynk_private_write on storage.objects for all to authenticated
using (
  bucket_id = 'maplestorynk-private'
  and (
    public.has_any_role(array['super_admin','editor']::public.app_role[])
    or (public.current_profile_role() = 'uploader' and (storage.foldername(name))[1] = auth.uid()::text)
  )
)
with check (
  bucket_id = 'maplestorynk-private'
  and (
    public.has_any_role(array['super_admin','editor']::public.app_role[])
    or (public.current_profile_role() = 'uploader' and (storage.foldername(name))[1] = auth.uid()::text)
  )
);

revoke execute on function public.capture_content_revision() from public;
revoke execute on function public.audit_row_change() from public;
