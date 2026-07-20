alter table public.document_imports
  add column if not exists source_file_name text,
  add column if not exists source_file_size bigint;

alter table public.document_import_assets
  add column if not exists image_index integer,
  add column if not exists upload_attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists registered_at timestamptz not null default now();

with numbered_assets as (
  select import_id, media_id, row_number() over (partition by import_id order by sort_order) as image_index
  from public.document_import_assets
  where image_index is null
)
update public.document_import_assets target
set image_index = numbered_assets.image_index
from numbered_assets
where target.import_id = numbered_assets.import_id and target.media_id = numbered_assets.media_id;

alter table public.document_import_assets
  alter column image_index set not null;

create unique index if not exists document_import_assets_image_index_idx
  on public.document_import_assets(import_id, image_index);

create table if not exists public.document_import_events (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.document_imports(id) on delete cascade,
  image_index integer,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  phase text not null check (phase in ('created', 'parsed', 'uploading', 'resumed', 'retry', 'uploaded', 'registered', 'status', 'finalized', 'cancelled', 'failed')),
  message text not null,
  bytes_total bigint,
  bytes_uploaded bigint,
  retry_count integer not null default 0,
  http_status integer,
  error_code text,
  elapsed_ms integer,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_import_events_import_created_idx
  on public.document_import_events(import_id, created_at desc);

alter table public.document_import_events enable row level security;
revoke all on public.document_import_events from anon, authenticated;

