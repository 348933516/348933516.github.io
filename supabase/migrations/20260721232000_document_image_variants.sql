-- Responsive display variants for large Word images. Originals remain the
-- authoritative lossless objects and are never overwritten by this migration.

alter table public.content_media
  add column if not exists image_variants jsonb not null default '[]'::jsonb;

alter table public.content_media
  add column if not exists image_variant_status text not null default 'pending';

alter table public.document_import_assets
  add column if not exists image_variants jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.content_media add constraint content_media_image_variants_array
    check (jsonb_typeof(image_variants) = 'array');
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.document_import_assets add constraint document_import_assets_image_variants_array
    check (jsonb_typeof(image_variants) = 'array');
exception when duplicate_object then null;
end $$;

create or replace function public.finalize_document_import(
  p_import_id uuid,
  p_content_id uuid,
  p_expected_version integer,
  p_actor_id uuid,
  p_body_html text,
  p_body_text text,
  p_source_record text,
  p_manifest jsonb
)
returns table(content_id uuid, version integer, imported_images integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.contents%rowtype;
  import_job public.document_imports%rowtype;
  asset_count integer;
begin
  select * into import_job from public.document_imports where id = p_import_id for update;
  if not found then raise exception 'IMPORT_NOT_FOUND'; end if;
  if import_job.content_id <> p_content_id or import_job.created_by <> p_actor_id then raise exception 'IMPORT_FORBIDDEN'; end if;
  if import_job.status <> 'uploading' then raise exception 'IMPORT_NOT_PENDING'; end if;

  select * into target from public.contents where id = p_content_id for update;
  if not found then raise exception 'CONTENT_NOT_FOUND'; end if;
  if target.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;

  asset_count := coalesce(jsonb_array_length(p_manifest), 0);
  if asset_count <> import_job.expected_images then raise exception 'IMAGE_COUNT_MISMATCH'; end if;

  begin
    insert into public.content_media (
      id, content_id, kind, storage_bucket, storage_path, original_storage_path,
      display_storage_path, image_variants, image_variant_status, content_hash, title, alt_text, width, height,
      mime_type, original_mime_type, size_bytes, original_size_bytes,
      sort_order, processing_status, created_by
    )
    select
      (asset->>'mediaId')::uuid, p_content_id, 'image', 'maplestorynk-public',
      asset->>'displayPath', asset->>'originalPath', asset->>'displayPath',
      coalesce(asset->'imageVariants', '[]'::jsonb), 'ready',
      nullif(asset->>'hash', ''), left(coalesce(asset->>'title', '图片'), 300),
      left(coalesce(asset->>'altText', '图片'), 500),
      nullif(nullif(asset->>'width', '')::integer, 0),
      nullif(nullif(asset->>'height', '')::integer, 0),
      case when jsonb_array_length(coalesce(asset->'imageVariants', '[]'::jsonb)) > 0 then 'image/webp' else asset->>'mimeType' end,
      asset->>'mimeType',
      nullif(asset->>'displaySize', '')::bigint,
      nullif(asset->>'originalSize', '')::bigint,
      nullif(asset->>'sortOrder', '')::integer, 'ready', p_actor_id
    from jsonb_array_elements(p_manifest) asset
    on conflict (id) do update set
      storage_bucket = excluded.storage_bucket,
      storage_path = excluded.storage_path,
      original_storage_path = excluded.original_storage_path,
      display_storage_path = excluded.display_storage_path,
      image_variants = excluded.image_variants,
      image_variant_status = 'ready',
      content_hash = excluded.content_hash,
      title = excluded.title,
      alt_text = excluded.alt_text,
      width = excluded.width,
      height = excluded.height,
      mime_type = excluded.mime_type,
      original_mime_type = excluded.original_mime_type,
      size_bytes = excluded.size_bytes,
      original_size_bytes = excluded.original_size_bytes,
      sort_order = excluded.sort_order,
      processing_status = 'ready'
    where content_media.content_id = excluded.content_id;
  exception when others then
    raise exception using
      message = 'IMPORT_MEDIA_INSERT_FAILED',
      detail = format('[%s] %s', sqlstate, sqlerrm);
  end;

  begin
    update public.contents as target_content
    set body_html = p_body_html,
        body_text = p_body_text,
        body_json = '{}'::jsonb,
        source_record = left(p_source_record, 20000),
        updated_by = p_actor_id
    where target_content.id = p_content_id
      and target_content.version = p_expected_version
    returning target_content.* into target;
    if not found then raise exception 'VERSION_CONFLICT'; end if;
  exception when others then
    raise exception using
      message = case when sqlerrm = 'VERSION_CONFLICT' then 'VERSION_CONFLICT' else 'IMPORT_CONTENT_UPDATE_FAILED' end,
      detail = format('[%s] %s', sqlstate, sqlerrm);
  end;

  update public.document_imports
  set status = 'completed', manifest = p_manifest, completed_at = now(), error_message = null
  where id = p_import_id;

  return query select target.id, target.version, asset_count;
end;
$$;

revoke all on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) from public;
grant execute on function public.finalize_document_import(uuid, uuid, integer, uuid, text, text, text, jsonb) to service_role;
