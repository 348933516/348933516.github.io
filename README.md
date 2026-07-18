# MapleStoryNK

MapleStoryNK is a public knowledge base with an invite-only administration system.

## Current deployment

- `/` keeps the existing single-file site online during migration.
- `/preview/` contains the React + TypeScript professional preview.
- The preview reads the legacy `site_state` row until the structured Supabase migration is applied.

The preview includes invite-only roles, server-sanitized rich-text editing, category ordering, Word/web import, multi-file media uploads, annotations and hierarchy paths, public/private Storage, revisions, account administration and audit logs.

## Local development

```powershell
pnpm install
pnpm dev
```

Quality checks:

```powershell
pnpm test
pnpm build
```

## Safe migration order

1. Run `pnpm backup:legacy` and verify the JSON in `local-backups/`.
2. Apply `supabase/migrations/20260719010000_professional_backend.sql`.
3. Disable public sign-ups in Supabase Authentication settings.
4. Deploy the Edge Functions under `supabase/functions/`.
5. Run `pnpm migrate:legacy` with the current owner email and password in environment variables. The script creates another local backup before writing anything.
6. Verify `/preview/`, role policies, uploads, revisions and public content.
7. Only then switch the GitHub Pages root build to the new application.

Never put `sb_secret`, `service_role`, a database password or a Supabase access token in frontend files.
