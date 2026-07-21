-- Recoverable queue for old images that predate responsive WebP previews.

alter table public.content_media
  add column if not exists image_variant_status text not null default 'pending';

do $$ begin
  alter table public.content_media add constraint content_media_image_variant_status_check
    check (image_variant_status in ('pending', 'processing', 'ready', 'failed'));
exception when duplicate_object then null;
end $$;

update public.content_media
set image_variant_status = case when jsonb_array_length(coalesce(image_variants, '[]'::jsonb)) > 0 then 'ready' else 'pending' end
where kind = 'image';

create index if not exists content_media_variant_queue_idx
  on public.content_media(image_variant_status, updated_at)
  where kind = 'image';
