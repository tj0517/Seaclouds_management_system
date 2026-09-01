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

**WARNING — `config.toml` is today the CLI scaffold, not the intended remote
state.** It describes the default local stack, and several Auth values in it
are *weaker* than what the remote projects run. Read on scl-dev + prod
(2026-08-31): pushing the scaffold as-is would **regress prod security** —
`mfa.totp.enroll_enabled`/`verify_enabled` true→false, `email.enable_confirmations`
true→false, `email.max_frequency` 1m0s→1s, `email.otp_length` 8→6. scl-dev
already sits at the weak values (dev), so its diff looked empty and hid the
problem. Never run `supabase config push` against prod until `config.toml`
holds the intended state. **Auth part done in PR #14** (2026-09-01): MFA TOTP
is on in the base (both envs, for task 1a.11 / O-14); email confirmations,
`otp_length = 8` and `max_frequency = "1m0s"` are prod-only under
`[remotes.production]` (scl-dev has no SMTP and the seed recreates users each
`db reset`); real per-env URLs live in `[remotes.<name>]` blocks keyed by
`project_id` (verified: `config push` logs `Loading config override`). That PR
also fixes a live prod bug — prod `site_url` pointed at `http://localhost:3000`,
so password-reset links were broken for all users. Leaked-password protection
is handled as a dashboard exception, see (h) below. **Still open for this task
(a):** everything non-Auth — storage buckets (the `expense-receipts` 5→15 MB
drift), SMTP, session/JWT and retention settings.

## b) Supabase advisor cleanup

Done 2026-08-31 (migrations `20260831143840_pin_function_search_path` and
`20260831143841_revoke_anon_and_public_grants` + pgTAP guard
`supabase/tests/advisor_grants.test.sql`): pinned `search_path` on all public
functions and revoked `anon`/`PUBLIC` grants on `public` tables, sequences and
functions (current objects and `postgres` default privileges). Lints 0027/0029
for the `authenticated` role stay **deliberately** — see the "Advisor" section
in `docs/03-conventions.md` before touching anything the advisor recommends.

Remaining:
- enable leaked-password protection in Auth — **resolved 2026-08-31**: enabled
  by hand in the dashboard on both projects as a conscious, dated exception,
  because CLI 2.75.0 cannot represent it in `config.toml`. Rationale and expiry
  condition in `docs/03-conventions.md` ("Advisor — świadomie akceptowane
  ostrzeżenia"); follow-up to move it into `config.toml` is (h) below.

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

## h) Move leaked-password protection into `config.toml`

Leaked-password protection (HaveIBeenPwned) is currently enabled by hand in the
dashboard on scl-dev and prod — a conscious, dated exception (see (b) and the
"Advisor — świadomie akceptowane ostrzeżenia" section in
`docs/03-conventions.md`) forced by CLI 2.75.0 having no `config.toml` key for
it: the `[auth]` decoder rejects `enable_leaked_password_protection` and
`password_hibp_enabled`. Being dashboard-only, it is invisible to `config push`
and to review — exactly the drift class this repo tries to avoid.

Trigger: a Supabase CLI version that adds the key. When bumping the pinned CLI
(`docs/toolchain.md`) for any reason, check the auth config schema
(`supabase config push` no longer rejects the key) and, if present, add it to
the base `[auth]` block, push to both projects, and delete this task plus the
dashboard exception note.

## i) Audit prod data possibly written from preview deployments

Discovered 2026-09-01: the Timesheet Vercel project's **Preview** environment
pointed `NEXT_PUBLIC_SUPABASE_URL` at the **prod** Supabase
(`tfbzivfsqsgebegcvfah`) for ~67 days (Preview env var created ~2026-06-26,
scl-dev did not exist until 2026-08-27). So any preview deployment in that
window could read/write prod data with unreviewed branch code — a broken
environment separation (brief §12.2), now being fixed by repointing Preview to
scl-dev (see the "Środowiska i deploymenty" rule in `docs/03-conventions.md`).

Task: with the team, check whether any production rows originated from preview
deployments in that window — timesheet entries, expense entries, PDF exports
(`pdf_exports` / storage `timesheet-exports`) — and decide whether they need
verification or cleanup. There is no per-request "which deployment wrote this"
field, so scope by `created_at` ranges and cross-check with known legitimate
activity; the service-role key was the same for preview and prod, so writes are
indistinguishable at the DB layer. Prioritise before any data-integrity-
sensitive reporting.
