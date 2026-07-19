alter table public.site_settings
  add column if not exists carousel_enabled boolean not null default true,
  add column if not exists carousel_autoplay boolean not null default true,
  add column if not exists carousel_interval_ms integer not null default 4500,
  add column if not exists carousel_transition text not null default 'slide';

alter table public.site_settings
  add constraint site_settings_carousel_transition_check
  check (carousel_transition in ('slide', 'fade'));

create table if not exists public.carousel_slides (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  subtitle text not null default '',
  image_path text not null,
  link_url text not null default '',
  link_label text not null default '查看详情',
  sort_order integer not null default 100,
  is_visible boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists carousel_slides_order_idx on public.carousel_slides(sort_order);

drop trigger if exists carousel_slides_touch on public.carousel_slides;
create trigger carousel_slides_touch before update on public.carousel_slides for each row execute function public.touch_updated_at();

alter table public.carousel_slides enable row level security;

drop policy if exists carousel_slides_public_read on public.carousel_slides;
create policy carousel_slides_public_read on public.carousel_slides for select to anon, authenticated
using (is_visible = true);

drop policy if exists carousel_slides_editor_write on public.carousel_slides;
create policy carousel_slides_editor_write on public.carousel_slides for all to authenticated
using (public.has_any_role(array['super_admin','editor']::public.app_role[]))
with check (public.has_any_role(array['super_admin','editor']::public.app_role[]));

grant select on public.carousel_slides to anon, authenticated;
grant insert, update, delete on public.carousel_slides to authenticated;
