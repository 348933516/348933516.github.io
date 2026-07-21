-- Image order is already uniquely identified by (import_id, image_index).
-- A second uniqueness rule on sort_order makes resumed imports fail when a
-- previous client calculated ordering from a different media count.

alter table public.document_import_assets
  drop constraint if exists document_import_assets_import_id_sort_order_key;

update public.document_import_assets
set sort_order = image_index * 10
where sort_order is distinct from image_index * 10;

create index if not exists document_import_assets_import_sort_idx
  on public.document_import_assets(import_id, sort_order);
