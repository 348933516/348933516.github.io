-- Remove the bundled theme without touching administrator-uploaded Storage assets.
update public.site_settings
set
  top_logo_path = case when top_logo_path like 'official/%' then null else top_logo_path end,
  hero_logo_path = case when hero_logo_path like 'official/%' then null else hero_logo_path end,
  tile_background_path = case when tile_background_path like 'official/%' then null else tile_background_path end
where
  top_logo_path like 'official/%'
  or hero_logo_path like 'official/%'
  or tile_background_path like 'official/%';

update public.categories
set image_path = null
where image_path like 'official/%';

alter table public.site_settings drop column if exists hero_background_path;
