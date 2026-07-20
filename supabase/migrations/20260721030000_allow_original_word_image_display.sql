-- Word imports now use the original browser-readable image as both the
-- archival and display object. The first assets migration added an unnamed
-- check requiring those paths to differ. PostgreSQL generated the constraint
-- name, so dropping a guessed name did not reliably remove it.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_record.conname
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace namespace_record on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'document_import_assets'
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) ilike '%original_path%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%display_path%'
  loop
    execute format(
      'alter table public.document_import_assets drop constraint %I',
      constraint_name
    );
  end loop;

  if exists (
    select 1
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace namespace_record on namespace_record.oid = table_record.relnamespace
    where namespace_record.nspname = 'public'
      and table_record.relname = 'document_import_assets'
      and constraint_record.contype = 'c'
      and pg_get_constraintdef(constraint_record.oid) ilike '%original_path%'
      and pg_get_constraintdef(constraint_record.oid) ilike '%display_path%'
  ) then
    raise exception 'Word import path compatibility constraint is still present';
  end if;
end
$$;
