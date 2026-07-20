-- A durable per-image manifest for large Word imports. The browser uploads
-- files directly to Storage, but each completed pair is registered by the
-- Edge Function before the document can be finalized.

create table if not exists public.document_import_assets (
  import_id uuid not null references public.document_imports(id) on delete cascade,
  media_id uuid not null,
  original_path text not null,
  display_path text not null,
  content_hash text,
  original_mime_type text,
  width integer,
  height integer,
  original_size_bytes bigint not null check (original_size_bytes > 0),
  display_size_bytes bigint not null check (display_size_bytes > 0),
  sort_order integer not null,
  title text not null default '图片',
  alt_text text not null default '图片',
  created_at timestamptz not null default now(),
  primary key (import_id, media_id),
  unique (import_id, sort_order),
  check (original_path <> display_path)
);

create index if not exists document_import_assets_import_idx on public.document_import_assets(import_id, sort_order);

alter table public.document_import_assets enable row level security;
revoke all on public.document_import_assets from anon, authenticated;

