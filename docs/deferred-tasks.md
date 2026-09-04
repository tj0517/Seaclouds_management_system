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

## g) Remove the temporary RLS probe from `apps/dcs` (closed 2026-09-02)

`apps/dcs/app/page.tsx` runs an unfiltered `select` on
`public.timesheet_entries` as the only live proof that RLS is enforced for
queries made from the DCS app. It deliberately violates the "DCS does not
read TES tables" rule (`docs/02-data-model.md`) — `timesheet_entries` is
currently the only table whose SELECT policy filters by `auth.uid()`.

Removal condition: the first `dcs.*` table with its own policies lands.
Move the RLS proof onto that table (as a pgTAP test and/or probe) and delete
the probe section from the page.

**Closed 2026-09-02**: the `timesheet_entries` probe is gone — `apps/dcs` no
longer reads any TES table. The proof moved to `dcs.mdr_settings` (first
`dcs.*` table with its own policies, DCS 1a.05): pgTAP
(`supabase/tests/rls_mdr_settings.test.sql`) plus a live probe on the page —
an unfiltered select (identical for admin and employee by design of the
current SELECT policy) and a side-effect-free write attempt whose insert
always trips a CHECK, so the error code alone shows who was stopped by what:
42501 = RLS rejected a non-admin before constraints ran, 23514 = RLS admitted
an admin and the CHECK stopped it. The role difference is produced by the
database, not the app.

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

## p) Follow-ups noted during DCS 1a.08 (PR #24, `public.audit_log`)

- ~~**`audit_log` SELECT policy "DC reads entries of own projects"** — waits
  on `is_doc_controller()` from 1a.09.~~ **Done** in DCS 1a.09 (PR #25,
  migration `20260903184934`): policy "Doc controllers read own project
  audit log", `project_id IS NOT NULL AND is_doc_controller(project_id)`;
  NULL-project rows (profiles/clients) stay admin-only.
- ~~**`dcs.dictionaries` under `audit_trigger()`** — 1a.07 attaches it when
  the table is created (the trigger requires an `id uuid` PK — keep that
  shape).~~ **Done** in DCS 1a.07 (migration `20260904081501`, trigger
  `audit_dictionaries`). Still true: tables with another PK
  (`dcs.mdr_settings`, PK = `project_id`) need a dedicated branch in
  `audit_trigger()` before attaching.
- **Audit of `dcs.mdr_settings` (cycle configuration) — separate task,
  Phase 1b** (owner's decision 2026-09-03 at the 1a.08 review). Notion
  "Gotowe, gdy" for 1a.08 names `projects.cycle_idc_to_ifr`, but the cycle
  columns live in `dcs.mdr_settings` (O-13, 1a.05), which 1a.08 deliberately
  left outside the trigger. Brief §5.9 lists "cycle configuration" among
  mandatory audit events, so the task is: add the PK branch to
  `audit_trigger()` (`mdr_settings` PK = `project_id`, no `id`; `project_id`
  scope = that column) and `create trigger audit_mdr_settings`. Not in
  PR #24.
- **TRUNCATE granted to `authenticated`/`service_role` on every other
  `public` table** (Supabase default privileges; TRUNCATE ignores RLS).
  Observed while locking down `audit_log`; TES tables were left untouched
  (out of scope, TES rule). Worth a dedicated revoke migration after a
  read of what the Timesheet app actually needs.
- **`occurred_at` is `now()` (transaction time)** — rows written in one
  transaction share a timestamp and have no intrinsic order. PostgREST runs
  one transaction per request, so this only matters for multi-statement
  server-side transactions; switch to `clock_timestamp()` or add a sequence
  if that ever becomes a real need.

## q) Follow-ups noted during DCS 1a.09 (PR #25, RLS helper functions)

- **`grantProjectRole` / `revokeProjectRole` still guard on admin only**
  (`requireAdmin` in `apps/dcs/lib/project-roles.ts`). Since 1a.09 the
  database lets a project's DC manage that project's roles, so the server
  action is now narrower than the policy. Widen the guard to "admin or DC
  of the target project" (server-side, `is_doc_controller` via RPC or a
  `project_roles` read) together with the role-matrix screen, task 1a.14 —
  not before, because nothing calls the action yet.
- **A DC can revoke their own `dc` row** and lose access to the project.
  The database does not prevent it (policies are per row, no "last DC"
  rule). Decide at 1a.14 whether the screen refuses it, or whether a
  trigger should keep at least one DC per project with an MDR.
- **`is_pm_for_project()` (TES `project_lead`) is not mapped to any DCS
  role** (ADR-0006/O-12). A TES project lead who is not in
  `dcs.project_roles` is a plain member for DCS (reads roles/clients of
  the project, writes nothing). Intentional; revisit only if the business
  wants leads to act as DC by default.
- **`clients` SELECT walks `projects` per row** (`exists … projects p …
  is_project_member(p.id)`). Fine at the current scale (tens of projects);
  if `clients` listing ever shows up in query stats, a
  `client_project_member(client_id)` helper is the cheap fix.
- **`has_project_role()` has no policy-level coverage beyond `{dc}`** — the
  only caller today is `is_doc_controller()`. Function-level assertions
  exist in `rls_project_role_functions.test.sql` (multi-element array that
  matches one held role, and one that matches none), but no policy uses
  another role set yet. When the first such policy lands (documents:
  ORIG/CHK/APP), add policy-level red/green assertions for it in the same
  PR.
- **`dcs.mdr_settings` SELECT is still open to every `authenticated`
  user** — `budget_hours` and the cycle lengths of every project are
  readable by any employee (policy from 1a.05, deliberately left in 1a.09).
  Review before Phase 4 (brief §3.5: clients enter the system); the
  natural replacement is `is_project_member(project_id)` now that it
  exists. Not changed in PR #25 (owner's instruction 2026-09-04).

## r) Follow-ups noted during DCS 1a.07 (`dcs.dictionaries`)

- **DC write access on `dcs.dictionaries`** — ships with the dictionary
  screen (1a.15), not before (same decision as `clients` in 1a.09). It needs
  a project-less `is_any_doc_controller()` helper (`exists (select 1 from
  dcs.project_roles where user_id = auth.uid() and role = 'dc')`): a new
  SECURITY DEFINER function → +1 × 0029 and a STOP gate. With it, decide
  whether DC may DELETE at all or only deactivate (`is_active = false`);
  the row comment already says the app never deletes.
- **`DICT_TYPES` in `apps/dcs/lib/dictionaries.ts` duplicates the CHECK
  list** by hand — unavoidable while `dict_type` is text (the generated
  types carry no literal union for a CHECK). Guarded since PR #26: CI step
  `scripts/check-dict-types.sh` (TS list ↔ CHECK in the local DB) and a
  pinned `bag_eq` in `rls_dictionaries.test.sql`. Adding a type = migration
  + constant + test list, in one PR.
- **Audit rows of `dcs.dictionaries` are admin-only** (`project_id` NULL,
  like `profiles`/`clients`). Once DCs edit dictionaries (1a.15) they will
  not see their own changes in the log; either widen the audit_log DC
  policy to `table_name = 'dcs.dictionaries'` or accept admin-only review.
- **`public.set_updated_at()` is reused** on `dcs.dictionaries` (as on
  `mdr_settings`) — a `public` function from the TES baseline. Fine today;
  if `dcs` ever needs to be self-contained (ADR-0003), it wants its own
  copy.
- **`meta jsonb` is unvalidated** — no per-type JSON schema (e.g.
  `default_budget_hours` for `doc_type`, `colour` for `workflow_status`).
  Define the shape with the seed (1a.18) and the screen (1a.15); a CHECK
  per type can follow once the keys are settled (O-05 for colours).
- ~~**CLAUDE.md wording "każda tabela `dcs.*`: kolumna `project_id`"**~~ —
  **resolved** in PR #26 (owner's decision 2026-09-04): rule softened to
  "every `dcs.*` table with project data carries `project_id`; a global or
  dictionary table needs an explicit entry in `02-data-model.md`". RLS +
  policies + pgTAP stay mandatory for every table.
- **Task prompt pointed at `20260827125731_remote_schema.sql` for
  `audit_trigger()`** — the function is not in that baseline; it lives in
  `20260903173128_create_audit_log.sql`. Read from there and from scl-dev.

## t) Follow-ups noted during DCS 1a.10 (RLS coverage close-out)

- **Ruleset "main protection" requires the `ci` status check but zero
  approving reviews** (`required_approving_review_count: 0`, no bypass
  actors, strict up-to-date policy on). A red pgTAP run does block the
  merge button (proven on PR #28), but a green run plus the author's own
  click is enough — there is no second pair of eyes. Fine for a one-person
  repo; revisit at the org transfer (deferred-tasks n).
- **CI runs only on `pull_request`**, never on `push` to `main`. Combined
  with the ruleset's PR requirement that is sufficient, but a merge of a PR
  that was green against a *stale* base could only be caught by the strict
  status-check policy (which is on). No action; recorded so nobody adds a
  `push: main` trigger "to be safe" and doubles the Supabase stack cost.
- **The anon layer-C proof depends on every table carrying an
  `is_admin()`-based policy**. If a future table's only policies avoid
  `is_admin()` (e.g. pure `is_project_member()`), the simulated-grant probe
  still passes (zero rows), but the "mechanism" assertion that names
  `is_admin` would need a sibling for that table. Keep the pattern in mind
  when documents land in 1b.
- **`dcs.mdr_settings` and `public.projects` SELECT are authenticated-wide**
  — now asserted as GREEN-by-design for an unrelated user in
  `rls_coverage_closeout.test.sql`, so the day the policy is narrowed the
  test turns red on purpose. The narrowing itself stays deferred (q).
## s) Follow-ups noted during the Vercel build-scope task (`chore/vercel-build-scope`)

- **HAZARD — `update-types` script in `apps/timesheet/package.json` points
  at the PRODUCTION project ref** (`--project-id tfbzivfsqsgebegcvfah`) and
  writes to `utils/supabase/types.ts`, a file that no longer exists (types
  come from `@scl/db` since PR #3). Running it needs a logged-in CLI with
  prod access, so it is a read against prod outside the CI process and a
  second, divergent type source if anyone commits its output. Remove the
  script; `pnpm db:gen` (local stack) is the only generator. Not touched in
  the build-scope PR (one task, one PR).
- **`supabase` (the CLI, `^2.72.7`) is a runtime `dependency` of
  `@scl/timesheet`**, while the project pins CLI 2.75.0 through
  `docs/toolchain.md` and CI. It is installed into every Timesheet build on
  Vercel for nothing. Move it out (the CLI is a global tool here) in its own
  PR, checking first that no script in the app calls `npx supabase`.
- **Splitting the generated types per product (`@scl/db` → public/core +
  a dcs-only package)** — analysed 2026-09-04, see the report in the PR for
  `chore/vercel-build-scope`. Verdict: the generator emits clean
  per-schema files (`--schema dcs` has no reference to `public`; cross-schema
  FK `Relationships` are dropped in both variants — they are `[]` in the
  combined file too), so a split is technically clean, but of the seven
  DCS migration commits so far only two (1a.06, 1a.07) changed nothing in
  the `public` section of `database.ts`. Five of seven would still have
  rebuilt Timesheet. Not worth a package split at this stage; revisit when
  Phase 1b adds many `dcs`-only tables.

## u) Follow-ups noted during DCS 1a.12 (`auth-helpers.ts` project-role guard)

- **The `cache()` wiring in `apps/dcs/app/data/actions/auth-helpers.ts` is
  not independently unit-tested.** React's `cache()` is a verified no-op
  outside a Next.js render (checked directly against
  `node_modules/react/cjs/react.production.js`: `exports.cache = fn =>
  (...args) => fn.apply(null, args)`), so a Vitest/node process can't
  exercise its per-request dedup. `apps/dcs/lib/auth-helpers.test.ts` tests
  `loadUserProjectRoles` — the dedup logic itself — against an explicit
  `Map` the caller owns, which is correct by construction under Next.js but
  leaves the `cache()` glue itself unverified by any automated test. No
  action proposed; same limitation Next's own `fetch` dedup has.
- **`docs/03-conventions.md` names `rls_timesheet_entries.test.sql` as the
  pgTAP pattern to follow**, but the current DCS pattern is
  `rls_project_roles.test.sql` (which superseded it), and by file
  modification time the newest/largest file is actually
  `rls_coverage_closeout.test.sql` (1a.10). The convention pointer is
  stale; fix it in a docs-only PR, not here.

## v) Follow-ups noted during DCS 1a.11 (2FA / aal2)

- **`apps/dcs` has no `/admin*` routes yet** (the app is still under
  construction) — the aal2 gate added to `apps/dcs/proxy.ts` is real code
  but currently inert there; it starts mattering the moment an `/admin`
  route is added. Confirmed by reading `apps/dcs/app` (only `login`, `auth`,
  `data` exist).
  Nothing was invented to make this "testable" — the RLS-level red proof
  (dev, direct SQL) is what actually exercises the aal2 logic today.
- **No forced re-challenge on session refresh beyond `proxy.ts`'s per-request
  check.** If Supabase ever changes a session's `aal` back to `aal1`
  mid-session (e.g. after a long-lived refresh token rotation), the next
  `/admin*` navigation catches it — there is no separate expiry/heartbeat
  mechanism, none was requested.
- **No automated (CI) test exercises the `proxy.ts` redirect.** Verified
  manually against the local stack (Playwright) per the acceptance
  criteria; a Playwright/e2e suite for auth flows doesn't exist in this repo
  yet (out of scope — would need its own task to introduce Playwright as a
  CI dependency, not something to bolt onto this PR).
- **`public.is_admin()`'s `SECURITY DEFINER` function has no `search_path`
  pinned** (pre-existing, predates 1a.11) — left untouched; not part of this
  task's scope and changing it is a STOP-gated function edit of its own.
- **Admin ALL policy on `dcs.dictionaries` also now requires aal2** — a
  scope decision made this task (criterion 1 only named DC write access
  explicitly; extending the same aal2 conjunct to the admin policy was
  confirmed before writing the migration, not assumed).
