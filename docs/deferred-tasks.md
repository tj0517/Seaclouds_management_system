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

Done 2026-08-31 (migrations `20260831143840_pin_function_search_path` and
`20260831143841_revoke_anon_and_public_grants` + pgTAP guard
`supabase/tests/advisor_grants.test.sql`): pinned `search_path` on all public
functions and revoked `anon`/`PUBLIC` grants on `public` tables, sequences and
functions (current objects and `postgres` default privileges). Lints 0027/0029
for the `authenticated` role stay **deliberately** — see the "Advisor" section
in `docs/03-conventions.md` before touching anything the advisor recommends.

Remaining:
- enable leaked-password protection in Auth — blocked on a decision (STOP 2);
  the change goes through `config.toml`/migration, never the dashboard.

## c) CI and Vercel configuration

- CI pipeline for the monorepo (install, lint, typecheck, build per app).
- Vercel project settings: **Root Directory = `apps/timesheet`** so Vercel
  builds the app from its new location. Env vars (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `RESEND_API_KEY`, `ADMIN_NOTIFICATION_EMAIL`) carry over unchanged.

## d) `<Database>` generic in the browser client factory

`@scl/db/client` (`createBrowserClient`) is untyped — moved 1:1 from the app,
where it was already untyped. Adding the `<Database>` generic will surface new
type errors in client components, so it is a deliberate, separate change.
**Clause: `apps/dcs` uses a typed client (with the generic) from day one —
Timesheet catches up later; DCS must not inherit the untyped path.**

## e) Lazy Resend initialization

The Resend client in the Timesheet app is instantiated at module scope, so it
runs during `next build` page-data collection — this is what broke the first
monorepo deploy on Vercel (PR #3) when the API key env var was stripped.
Switch to lazy initialization (instantiate on first use inside the server
action), which also removes the need for a dummy `RESEND_API_KEY` in CI builds.

## f) Warn when prod migrations lag behind main

A check that compares migration files on `main` with the applied history on
prod (read-only: `supabase migration list` against the prod project, or a
`SELECT version FROM supabase_migrations.schema_migrations`) and warns when
prod is missing migrations that `main` already has.

Since the prod push moved to `workflow_dispatch` (PR #8), nothing reminds
anyone that a migration is waiting to be pushed — a merged migration reaches
scl-dev automatically and then sits silently until someone remembers to
dispatch the prod job. Possible shapes: a scheduled workflow that opens/updates
an issue, a step in the dev-push job that prints a `::warning`, or a badge in
the README. Needs a prod-readable credential, so mind the token-scoping rules
from `deploy-db.yml`.

## g) Remove the temporary RLS probe from `apps/dcs`

`apps/dcs/app/page.tsx` runs an unfiltered `select` on
`public.timesheet_entries` as the only live proof that RLS is enforced for
queries made from the DCS app. It deliberately violates the "DCS does not
read TES tables" rule (`docs/02-data-model.md`) — `timesheet_entries` is
currently the only table whose SELECT policy filters by `auth.uid()`.

Removal condition: the first `dcs.*` table with its own policies lands.
Move the RLS proof onto that table (as a pgTAP test and/or probe) and delete
the probe section from the page.
