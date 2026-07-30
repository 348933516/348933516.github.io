alter table public.site_settings
  add column if not exists favicon_path text,
  add column if not exists favicon_provider text not null default 'supabase';

do $$ begin
  alter table public.site_settings
    add constraint site_settings_favicon_provider_check
    check (favicon_provider in ('supabase', 'tencent_cos'));
exception when duplicate_object then null; end $$;
