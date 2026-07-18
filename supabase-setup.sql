-- MapleStoryNK Supabase setup
-- Run this once in Supabase Dashboard -> SQL Editor.
-- This creates the shared site state table used by the GitHub Pages frontend.

create table if not exists public.site_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_state enable row level security;

drop policy if exists "site_state_public_read" on public.site_state;
create policy "site_state_public_read"
on public.site_state
for select
to anon, authenticated
using (id = 'main');

drop policy if exists "site_state_authenticated_insert" on public.site_state;
create policy "site_state_authenticated_insert"
on public.site_state
for insert
to authenticated
with check (id = 'main');

drop policy if exists "site_state_authenticated_update" on public.site_state;
create policy "site_state_authenticated_update"
on public.site_state
for update
to authenticated
using (id = 'main')
with check (id = 'main');

insert into public.site_state (id, data)
values (
  'main',
  jsonb_build_object(
    'version', 1,
    'categories', jsonb_build_array('WZ业务目录', '定制地图展示', 'BOSS配套地图展示', '系列地图'),
    'categoryImages', '{}'::jsonb,
    'categoryTexts', '{}'::jsonb,
    'contents', '[]'::jsonb,
    'appearance', jsonb_build_object(
      'topLogo', '',
      'heroLogo', '',
      'logo', '',
      'pageBg', '',
      'heroBg', '',
      'tileBg', '',
      'brandTitle', 'MapleStoryNK',
      'brandSubtitle', '业务与地图资料中心',
      'heroTitle', 'MapleStoryNK',
      'heroSubtitle', '资料展示、地图内容、WZ 业务与 BOSS 配套信息统一整理。',
      'categoryTitle', '类目展示',
      'categorySubtitle', '选择一个类目进入查看详细资料。'
    ),
    'updatedAt', now()
  )
)
on conflict (id) do nothing;

create extension if not exists pgcrypto;

-- Optional public storage bucket for future file uploads.
insert into storage.buckets (id, name, public)
values ('maplestorynk-media', 'maplestorynk-media', true)
on conflict (id) do nothing;

drop policy if exists "maplestorynk_media_public_read" on storage.objects;
create policy "maplestorynk_media_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'maplestorynk-media');

drop policy if exists "maplestorynk_media_authenticated_upload" on storage.objects;
create policy "maplestorynk_media_authenticated_upload"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'maplestorynk-media');

drop policy if exists "maplestorynk_media_authenticated_update" on storage.objects;
create policy "maplestorynk_media_authenticated_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'maplestorynk-media')
with check (bucket_id = 'maplestorynk-media');

drop policy if exists "maplestorynk_media_authenticated_delete" on storage.objects;
create policy "maplestorynk_media_authenticated_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'maplestorynk-media');
