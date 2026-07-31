-- PostgreSQL requires RETURN QUERY columns to exactly match the declared
-- table shape. contents.status is an enum, while this RPC exposes text.
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

  for promotion in select value from jsonb_array_elements(coalesce(p_promotions, '[]'::jsonb))
  loop
    if (promotion->>'provider') not in ('supabase', 'tencent_cos')
      or coalesce(promotion->>'destinationBucket', '') = ''
      or coalesce(promotion->>'storagePath', '') = '' then
      raise exception 'INVALID_PROMOTION';
    end if;
    if promotion->>'table' = 'content_media' then
      update public.content_media set
        storage_provider = promotion->>'provider',
        storage_bucket = promotion->>'destinationBucket',
        storage_path = promotion->>'storagePath',
        original_storage_path = nullif(promotion->>'originalStoragePath', ''),
        display_storage_path = nullif(promotion->>'displayStoragePath', ''),
        image_variants = coalesce(promotion->'imageVariants', '[]'::jsonb)
      where content_media.id = (promotion->>'id')::uuid and content_media.content_id = p_content_id;
    elsif promotion->>'table' = 'attachments' then
      update public.attachments set
        storage_provider = promotion->>'provider',
        storage_bucket = promotion->>'destinationBucket',
        storage_path = promotion->>'storagePath'
      where attachments.id = (promotion->>'id')::uuid and attachments.content_id = p_content_id;
    else
      raise exception 'INVALID_PROMOTION_TABLE';
    end if;
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
