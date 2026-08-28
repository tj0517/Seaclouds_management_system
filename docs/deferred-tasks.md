# Deferred tasks

Work intentionally postponed. Not part of the current monorepo restructuring —
do not start these without an explicit go-ahead.

## a) Capture project settings into `config.toml`

Audit what our CLI version (`supabase` 2.75.0) supports representing in
`supabase/config.toml` — storage bucket definitions, Auth providers/settings,
SMTP, session/JWT and retention settings, etc. — and pull whatever is
supported into the repo so project configuration lives in version control
instead of the dashboard.

Trigger: `expense-receipts` bucket was 5 MB in the migration but 15 MB on prod
because it was raised by hand in the dashboard. Dashboard drift is invisible to
`db diff`. See the "Database change policy" section in `CLAUDE.md`.

## b) Supabase advisor cleanup

From the Supabase advisor / linter:
- functions without a pinned `search_path` (`is_admin`, `is_admin_or_pm`,
  `is_pm_for_project`, `handle_new_user`, `resubmit_rejected`, `set_updated_at`,
  `is_week_locked`) — set `SET search_path = ''` or an explicit schema list;
- `REVOKE` overly-broad grants from the `anon` role where not needed;
- enable leaked-password protection in Auth.

Each is a schema/config change, so it goes through a migration (or `config.toml`
for the Auth setting), never the dashboard. Do a fresh `get_advisors` read
before acting — the list above is a snapshot.

## c) CI and Vercel configuration

- CI pipeline for the monorepo (install, lint, typecheck, build per app).
- Vercel project settings: **Root Directory = `apps/timesheet`** so Vercel
  builds the app from its new location. Env vars (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `RESEND_API_KEY`, `ADMIN_NOTIFICATION_EMAIL`) carry over unchanged.
