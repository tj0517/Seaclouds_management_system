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
also corrects prod `site_url`, which pointed at `http://localhost:3000` — config
hygiene, not an outage: Timesheet has no self-service email password reset
(passwords change in a panel form), so no user-facing flow was broken. `site_url`
still backs email confirmations and any future email link flows, so the real
domain belongs there. Leaked-password protection is handled as a dashboard
exception, see (h) below. **Still open for this task
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

## g) Remove the temporary RLS probe from `apps/dcs` — **DO ZROBIENIA TERAZ (2026-09-02)**

`apps/dcs/app/page.tsx` runs an unfiltered `select` on
`public.timesheet_entries` as the only live proof that RLS is enforced for
queries made from the DCS app. It deliberately violates the "DCS does not
read TES tables" rule (`docs/02-data-model.md`) — `timesheet_entries` is
currently the only table whose SELECT policy filters by `auth.uid()`.

Removal condition: the first `dcs.*` table with its own policies lands.
Move the RLS proof onto that table (as a pgTAP test and/or probe) and delete
the probe section from the page.

**Condition met 2026-09-02**: `dcs.mdr_settings` exists with its own policies
and pgTAP coverage (`supabase/tests/rls_mdr_settings.test.sql`, DCS 1a.05).
The probe removal is a small separate PR right after 1a.05 — deliberately kept
out of that task's scope.

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

## i) Preview → prod Supabase (closed 2026-09-01)

The Timesheet Vercel project's Preview env pointed at the prod Supabase for
~67 days (until repointed to scl-dev — see the "Środowiska i deploymenty" rule
in `docs/03-conventions.md`). Checked and closed: Preview was used only by the
repo owner in that window, with no impact on production data.

## j) Drop the SCC005 project_code exception

The `projects_project_code_format` CHECK (migration
`20260901082600_enforce_project_code_format`) allows one off-format code by
name: `= 'SCC005'` (the "ISO Certyfikacja" project). It is a legacy carve-out,
never a pattern — relaxing it to `^SCC` would readmit every future off-format
code. O-11 stays only partially resolved because of it.

Trigger: a decision on that project (Sea Clouds DC/MD). When SCC005 is
renumbered to the SCYYNN format or archived, add a migration that updates the
row (if renumbered) and replaces the constraint without the `or project_code =
'SCC005'` member, regenerate types (`pnpm db:gen` — no type change expected,
the column stays NOT NULL), update the pgTAP guard
(`supabase/tests/project_code_format.test.sql`) and close O-11.

## k) Validate project_code in the create/edit project form

Since migration `20260901082600_enforce_project_code_format`, `project_code` is
`NOT NULL` + format-checked in the DB, but the form does not validate it:
`app/data/actions/projects.ts` does `(formData.get('project_code'))?.trim() ||
null`, so an empty or off-format code reaches the DB and surfaces the raw
constraint error (`... violates check constraint ...` / NOT NULL) instead of a
readable message. Add client/server-side validation of the same pattern
(`^SC\d{4}$` / `^SCMS` / the SCC005 carve-out) and a friendly error before the
insert/update. Separate PR (UI/UX, no schema change).

## l) Prove the production-db gate with prod logs on the next migration (closed 2026-09-01)

The Supabase GitHub integration used to apply migrations and `config.toml` to
prod on every merge to `main`, bypassing `deploy-db.yml` and the
`production-db` approval gate — so the gate has never actually done real work
([ADR-0007](adr/0007-deploy-bazy-wylacznie-przez-ci.md)). The integration is
now disabled, but disabled-in-dashboard is a claim, not a proof.

Task: on the FIRST migration merged after 2026-09-01, verify from prod logs
that the DDL came exclusively from the `deploy-db.yml` dispatch run and not
from Supabase infrastructure:

- `workflow_run_logs` (prod project) must show NO `Cloning git repo… git_ref=main`
  / `Applying migration…` entries around the merge time;
- `postgres_logs` must show the migration DDL only at the time of the manual
  `workflow_dispatch` run, with `connection_from` matching a GitHub runner
  (Azure), not Supabase infra (AWS us-east-1);
- until then, after every merge with migrations, read
  `supabase_migrations.schema_migrations` on prod and confirm the new version
  is absent before the dispatch.

The gate is proven only when this check passes — then close this task and note
the date in ADR-0007.

**Closed 2026-09-01** — proven on migration `20260901123548_add_clients_table`
(PR #17, merged 12:52:06Z; manual dispatch run 33515391851, 13:46:24–39Z):

- `workflow_run_logs` (prod): zero entries over the whole 12:45–13:55Z window —
  no `Cloning git repo…`, integration silent (previously it reacted ~30 s
  after a merge).
- `schema_migrations` (prod) read before the dispatch: `20260901123548`
  absent; after the run: present.
- `postgres_logs` (prod): the migration DDL appears exactly once, at
  13:46:36.276–.639Z — matching the dispatch run's `Applying migration…`
  log line (13:46:36.34Z) to the millisecond; no DDL anywhere else in the
  merge→dispatch window.
- **Correction to the criterion as originally written:** `connection_from`
  shows `2a05:d018:…` (AWS eu-west-1), not an Azure runner address — GitHub
  runners are IPv4-only, so `supabase db push` connects through the Supavisor
  pooler (`aws-1-eu-west-1.pooler.supabase.com`) and postgres sees the
  pooler's address. The discriminator that actually separates the gate from
  the old integration is: eu-west-1 pooler + millisecond timing match +
  zero `workflow_run_logs`, versus the integration's `2600:1f18:…`
  (AWS us-east-1 Supabase workflow infra) + `Cloning git repo…` entries.
  Zero connections from `2600:1f18:…` in the whole window.

## m) Postgres patch-version gap between scl-dev and prod

scl-dev runs Postgres image `17.6.1.166`, prod `17.6.1.063` (dashboard
reading 2026-09-01; both report `server_version` 17.6 — the build suffix is
the Supabase image revision, visible only in the platform, not in SQL).
A patch-level difference between the integration and production environment
is a small but real fidelity gap: behaviour verified on scl-dev can in
principle differ on prod (planner fixes, extension builds, Supabase image
changes). Nothing to fix right now — this note exists so that when prod
behaves oddly in a way scl-dev does not reproduce, the image gap is checked
early instead of after hours of debugging. Upgrading prod's image to match
(dashboard/infrastructure operation, not a migration) is the eventual
resolution; revisit when planning the next maintenance window.

## n) Secrets review and rotation at the Sea Clouds org transfer

When the repo moves to the Sea Clouds GitHub organization, run one combined
review-and-rotation of all secrets instead of piecemeal fixes:

- **`RESEND_API_KEY`** — rotate; the pre-2026-09-01 key sat for months in
  a developer-machine `.env.local` alongside credentials of a foreign
  Supabase project (`qyrf…`, not in the Sea Clouds org), so treat it as
  potentially overexposed. Canonical copy lives in Vercel env vars.
- **Supabase `service_role` keys** (prod + scl-dev) — rotate and update
  Vercel env vars.
- **CI tokens** — `SUPABASE_ACCESS_TOKEN_DEV` and the prod token scoped to
  the `production-db` environment (ADR-0005): reissue under the org account
  so they stop depending on a personal account.

Trigger: the org transfer. Context: the old `apps/timesheet/.env.local`
(backed up to `~/Desktop/seaclouds/backups/timesheet-env-local-qyrf-2026-09-01.txt`,
chmod 600) was found on 2026-09-01 pointing at the foreign `qyrf…` project
with a live `service_role` key; the fate of that project is the owner's
open question and is deliberately NOT part of this task.

## o) Follow-ups noted during DCS 1a.06 (PR #23, `dcs.project_roles`)

Temptations recorded in the 1a.06 report and deliberately NOT fixed in that
PR (one topic per PR). Each item names its owner task or trigger:

- **`docs/01-architecture.md` says "schemat `dcs` jeszcze nie istnieje"** —
  stale since 1a.05 (`20260902114742_create_dcs_schema`). Docs-only fix; do
  it with the next docs PR.
- **Comments in pushed migration `20260902114744_create_mdr_settings.sql`
  say `project_members`** — the table landed as `dcs.project_roles`
  (ADR-0008). Pushed migrations are never edited; this is a permanent note,
  not a task. Same for `apps/dcs/app/page.tsx` history.
- **ADR-0006 title and body use `project_members` / `viewer`** — accepted
  ADRs are not rewritten; ADR-0008 supersedes the naming. If a reader trips
  over it, add a one-line "superseded by ADR-0008 for naming" banner to
  ADR-0006 — a docs PR, no code.
- **`deactivateUser` in TES deletes only `project_assignments`** — a
  "deactivated" user keeps every `dcs.project_roles` row. Whether DCS
  deactivation should revoke roles (and who may do it) belongs to the role
  matrix screen, task 1a.14; nothing to change in the table.
- **No `revalidatePath()` in `grantProjectRole` / `revokeProjectRole`** —
  no page renders project roles yet. 1a.14 adds the paths together with the
  screen (commented in `apps/dcs/app/data/actions/project-roles.ts`).
- **Supabase CLI 2.116.0 available (pinned 2.75.0)** — the pin determines
  the Postgres image and `gen types` output (`docs/toolchain.md`), so a bump
  is its own task; when it happens, also re-check (h) above.
