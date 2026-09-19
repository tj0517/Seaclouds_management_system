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
- **`deploy-db.yml` depends on `SUPABASE_ACCESS_TOKEN_DEV` having enough
  capability for `supabase link`, not just `db push`** — rotated 2026-09-11
  after it failed exactly there, expires ~Jan 2027. Full context, the prod-side
  check to run before the next production gate, and the `gh run rerun` recovery
  path are in (n).

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
- **A fine-grained Supabase access token can pass everything except
  `supabase link`** — learned the hard way on 2026-09-11 (DCS 1a.15b, PR #44):
  the merge to `main` ran `deploy-db.yml`, which died 4 s in on
  `supabase link --project-ref mzotiurydmhibqhxxzoh` with *"Authorization
  failed for the access token and project ref pair: Your account does not have
  the necessary privileges to access this endpoint"* — the old
  `SUPABASE_ACCESS_TOKEN_DEV` lacked one capability `link` needs, so the
  migration silently did not reach scl-dev even though the merge itself looked
  clean. Rotated the same day to a **full-capability token scoped to scl-dev
  only** (the scoping rule from `deploy-db.yml` still holds: repository
  secrets are readable by any workflow on any branch, so this must never be
  prod-capable); **expires ~Jan 2027** — see (c) for the workflow that depends
  on it. **Before the next production gate, check the prod token the same way**
  with a local `supabase link --project-ref tfbzivfsqsgebegcvfah`: a
  `workflow_dispatch` that fails at `link` would burn the `production-db`
  approval for nothing. Recovery, once a token is fixed, is
  `gh run rerun <run-id>` on the failed push run — a `workflow_dispatch`
  will not do it, because the dev job is gated on
  `if: github.event_name == 'push'` and dispatch runs the prod job instead.

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

- ~~**`grantProjectRole` / `revokeProjectRole` still guard on admin only**
  (`requireAdmin` in `apps/dcs/lib/project-roles.ts`). Since 1a.09 the
  database lets a project's DC manage that project's roles, so the server
  action is now narrower than the policy. Widen the guard to "admin or DC
  of the target project" (server-side, `is_doc_controller` via RPC or a
  `project_roles` read) together with the role-matrix screen, task 1a.14 —
  not before, because nothing calls the action yet.~~ **Done** in DCS 1a.14
  (`requireAdminOrDc` in `apps/dcs/lib/project-roles.ts`, used by
  `grantProjectRole`, `revokeProjectRole` and the new `setProjectRoles`) —
  [ADR-0012](adr/0012-dc-zarzadza-rolami-swojego-projektu-w-aplikacji.md).
- **A DC can revoke their own `dc` row** and lose access to the project.
  The database does not prevent it (policies are per row, no "last DC"
  rule). **Still open after 1a.14**: the role-matrix screen does not refuse
  it — neither `setProjectRoles` nor the UI special-cases "the last DC row."
  1a.14's scope excluded any schema/policy change, so a trigger-based fix
  was out of reach even if wanted; whether the screen should instead refuse
  the save client/server-side, or whether a "last DC" trigger is the right
  fix, remains a product decision for whoever picks this up next.
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

- ~~**DC write access on `dcs.dictionaries`** — ships with the dictionary
  screen (1a.15), not before (same decision as `clients` in 1a.09). It needs
  a project-less `is_any_doc_controller()` helper (`exists (select 1 from
  dcs.project_roles where user_id = auth.uid() and role = 'dc')`): a new
  SECURITY DEFINER function → +1 × 0029 and a STOP gate. With it, decide
  whether DC may DELETE at all or only deactivate (`is_active = false`);
  the row comment already says the app never deletes.~~ **Done, in two
  steps.** The DB half (helper + INSERT/UPDATE policies + aal2 conjunct)
  landed earlier than this note implies — migrations `20260904125543`
  (1a.09b) and `20260904160000` (1a.11) — so by the time 1a.15 built the
  screen there was no migration left to write, only the app guard
  (`requireAdminOrAnyDc` in `apps/dcs/lib/dictionaries-admin.ts`, mirroring
  `is_any_doc_controller()`) and the UI. DELETE stays admin-only, per the
  question this note posed — the screen only ever calls
  `setDictionaryEntryActive`, never a delete action.
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
- **The admin `ALL` policy ("Admins manage dictionaries") is untouched by
  this task** — only the two DC write policies (INSERT/UPDATE) carry the
  aal2 conjunct, matching acceptance criterion 2 exactly. An earlier draft
  of this PR extended aal2 to the admin policy too and an earlier version
  of this note claimed that was confirmed with the requester — it was not;
  reverted before merge.

## w) Follow-ups noted during DCS 1a.22 (`public.module_permissions`)

- **`proxy.ts` (both apps) and `apps/timesheet/app/admin/layout.tsx` do not
  consume this table** — by design, acceptance criterion 5. This is the
  table the DC-without-admin mismatch found in 1a.11 (see (v) above) is
  meant to eventually resolve through, but wiring either gate to read
  `module_permissions` is its own task, not folded in here.
- **`apps/dcs` has no admin routes yet**, so the "Module Access" screen
  lives only in Timesheet's existing `admin/users/[id]` page — the one
  admin user-management screen that currently exists in the monorepo. When
  DCS gets its own admin panel (or the two panels merge — an open question,
  not decided here), revisit whether module grants belong there too or stay
  Timesheet-only.
- **No auto-revoke on role demotion.** The data migration grants DCS to
  every `profiles.role = 'admin'` account once, at migration time; nothing
  keeps that in sync afterwards — an admin later demoted to `employee` keeps
  DCS access until a human unchecks it on the Module Access screen. Same
  shape as `deferred-tasks.md` (o)'s note on `deactivateUser` and DCS role
  rows: intentional, not an oversight — auto-revoke tied to a role change is
  a policy decision (who decides, does it apply to BMS too) that belongs
  with whichever task next touches this table.
- **`supabase/seed.sql`'s admin fixture (`tjezionekspam@gmail.com`) does not
  end up with DCS access after a local `supabase db reset`.** The seed
  creates the auth user (role defaults to `employee` via
  `handle_new_user()`), then `UPDATE`s `profiles.role = 'admin'` — by then
  the 1a.22 data migration has already run, over zero rows, so the
  admin-gets-DCS backfill never sees this account. `rls_module_permissions.test.sql`
  works around it by inserting the DCS row directly, as `postgres`, matching
  how other tests (e.g. `rls_dictionaries.test.sql` with `dcs.project_roles`)
  already set up role-like fixtures by hand rather than relying on seed
  order. Not fixed here: no acceptance criterion needs the local seed's
  admin fixture to have DCS access, and teaching the seed script about this
  ordering is separate from the table itself.

## x) Follow-ups noted during DCS 1a.13 (module switcher)

- ~~**`apps/dcs/app/(app)/page.tsx` still carries the `dcs.mdr_settings`
  RLS-probe debug block**~~ — **CLOSED 2026-09-16 (DCS 1a.21a,
  `chore/dcs-1a21a-demo-prep`).** Ownership moved from 1b.05 to 1a.21a: the
  1a gate is a live demo in front of the client's Document Controller and MD,
  and diagnostic UI cannot be on screen for it — that need arrived before the
  MDR register did. Removed: the write half (a deliberately CHECK-violating
  `INSERT` on every render of `/`) and the blue panel reporting its SQLSTATE.
  Kept: the unfiltered `select` on `dcs.mdr_settings`, which was always the
  Cycle column's source and is now commented as such. The RLS proof it stood
  for lives on in `supabase/tests/rls_mdr_settings.test.sql`; a regression
  test in `apps/dcs/app/(app)/nav.test.ts` asserts the page never INSERTs
  into that table again. The `supabase/seed.sql` comment naming the probe was
  corrected in the same PR. Original text follows.

- **[original]** The block came from 1a.05/1a.09 test scaffolding, moved as-is
  into the new route shell. It still demonstrates RLS correctly (unfiltered
  select + CHECK-tripping write probe). **Owner: 1b.05**, where the MDR
  register replaces this placeholder project list and the block disappears
  on its own (owner's decision, 2026-09-05 — no task number for this was
  documented before that). Superseded candidates checked and ruled out:
  1a.17 (Create Project MDR wizard — creates one project, doesn't list
  them) and 1a.14 (role matrix screen — reached by clicking into a project
  from a list, doesn't own the list itself).
- ~~**No mobile drawer/hamburger on `apps/dcs/components/DcsSidebar.tsx`**~~ —
  **CLOSED 2026-09-17 (DCS 1a.24, `feat/dcs-1a24-ui-polish`).** The drawer
  lives in `apps/dcs/components/AppShell.tsx` (shadcn `Sheet` over
  `@radix-ui/react-dialog`, already a dependency since 1a.15 — no new
  package), opened from a header button below 768px, and it renders the
  **same** `DcsSidebar`, not a phone-shaped copy of it. Tapping an entry
  dismisses it. Verified at 375px: drawer 272px wide, offering exactly
  Projects · Dictionaries · Clients. Closed together with the icon half
  below, in one pass, as that entry asked. Original text follows.

- **[original]** No mobile drawer/hamburger on
  `apps/dcs/components/DcsSidebar.tsx`,
  unlike Timesheet's `AdminSidebar` (which has one). Trigger was **1a.14**
  ("the first task that adds a second nav entry") — 1a.14 came and went
  without one. **Update (DCS 1a.21a, 2026-09-16): the premise "DCS has
  exactly one nav entry today" is no longer true** — the sidebar now carries
  three (Projects, Dictionaries, Clients), so the condition this item waited
  on has actually fired. Still not done: 1a.21a's scope was the links, and a
  drawer is a layout change with its own review. No new trigger invented —
  whoever next touches `DcsSidebar` owns it.
- ~~**`DcsSidebar` nav uses plain text, no icon library**~~ — **CLOSED
  2026-09-17 (DCS 1a.24).** Every entry now carries a lucide icon
  (`FolderKanban` / `BookMarked` / `Building2`, plus `LogOut` on sign out),
  done in one pass so no second style was introduced, exactly as this entry
  required. The original note, already half-stale, follows: the dependency
  half is **obsolete**: `apps/dcs/package.json` has carried `lucide-react`
  since 1a.15 brought in shadcn/ui, so "DCS has no icon dependency" is simply
  stale (verified 2026-09-16). What remains is a choice, not a blocker: the
  nav is still plain text. 1a.21a kept it that way deliberately — adding
  icons to two new entries and not the existing one would have introduced a
  second style mid-task. Do it in one pass, with the drawer above.

- **A non-admin session issues two identical `dcs.project_roles` reads per
  guarded `/admin` page** (DCS 1a.21a): once in `app/(app)/layout.tsx` for
  the sidebar links, once inside the page itself for its guard — plus a third
  in `proxy.ts`, which reads the same table on the same prefix for the aal2
  gate. Deduping the first two is easy in principle (`getUserProjectRoles` in
  `app/data/actions/auth-helpers.ts` is already `cache()`-backed per request),
  and was **deliberately not done**: `canOpenAdminScreens` takes a Supabase
  client instead of reaching for React's `cache()`, and that is precisely
  what lets it be unit-tested without a Next.js runtime — the same trade-off
  `lib/auth-helpers.ts` documents for `loadUserProjectRoles`. An admin pays
  none of it (the read is skipped when `profiles.role = 'admin'`). Trigger:
  a measured problem, or a third non-admin caller on the same request. Not
  before — untestable-but-faster is the wrong direction for this file.

  **MEASURED 2026-09-17 (DCS 1a.24) — not significant, still not fixed.**
  The trigger above says "a measured problem", so it was measured, against
  scl-dev, on a local production build. An admin and a DC differ by exactly
  these reads, so the gap between them is the cost. Five samples each,
  median:

  | Route | admin | `dcs1a14-dc` | delta |
  |---|---|---|---|
  | `/admin/dictionaries` | 416 ms | 422 ms | **+6 ms** |
  | `/admin/clients` | 394 ms | 425 ms | **+31 ms** |

  Within-session spread was 30–35 ms, so `/admin/dictionaries` shows nothing
  at all and `/admin/clients` shows a delta no larger than the noise. Two
  caveats, so nobody reads more into this than it holds: the two sessions do
  not render identical row counts (`clients`' RLS narrows the list for a DC,
  which if anything makes the DC's page *cheaper*), and every one of these
  routes costs 400 ms regardless — the duplicate read is not where the time
  goes. **Conclusion: the trigger has NOT fired.** Deduping remains the wrong
  trade against the testability argument above. Do not revisit without a
  third non-admin caller.

## y) Follow-ups noted during DCS 1a.23 (portal tiles + shared-domain SSO)

- **Module-permission read helpers stay duplicated, not merged into
  `@scl/db`.** `apps/timesheet/app/data/actions/module-permissions.ts`
  (`getMyModuleAccess`) and `apps/dcs/lib/module-permissions.ts`
  (`fetchMyModuleAccess`) are near-identical — same query shape, same
  catch-log-degrade behaviour, same `{ modules, degraded }` return shape —
  and 1a.23 adds two new shared `@scl/db` leaf exports (`cookie-options`,
  `module-access`) that are exactly this kind of cross-app logic, but left
  these two alone. Tempting to fold in while touching the surrounding code;
  still not done — merging them wasn't asked for either time they were
  touched. Update (module-switcher-visibility follow-up): the "third
  consumer" trigger below has now fired twice over — both functions gained
  more same-app callers (TES: portal redirect + 3 switcher mounts; DCS:
  route gate + sidebar) — but that's more callers *within* each app, not a
  cross-app one, so the merge trigger still hasn't actually fired. The
  earlier plain fail-closed `getMyModulePermissions()` (TES) is gone,
  replaced everywhere by `getMyModuleAccess()`, so there's one function per
  app now, not two — makes the eventual `@scl/db` merge more mechanical
  whenever it happens. Trigger: whoever next has to edit either one, or 1b
  if/when a third consumer of the same read shows up.
- **A TES-side module gate was built, then removed, during this task.**
  Mirroring DCS's `hasModuleAccess` call in `apps/dcs/proxy.ts`,
  `apps/timesheet/proxy.ts` briefly gated every non-portal route on a `tes`
  row in `public.module_permissions`, redirecting to `/` when missing.
  Removed before merge, for three reasons: (1) no acceptance criterion asked
  for it — 1a.23's gating proof and examples are all about the `dcs` row,
  never `tes`; (2) it introduced a real self-lockout — an admin/DC revoking
  their own `tes` row would lock themselves out of the only app that could
  restore it, since Timesheet has no equivalent of "log in elsewhere and
  grant it back"; (3) it complicated the degrade-loud requirement — making
  the TES portal tile conditional on the same ambiguous read DCS uses
  risked hiding the app's own home module on a table-missing error, which
  1a.23's own scope explicitly rules out. The portal's TES tile is
  unconditional instead (`apps/timesheet/app/page.tsx`), mirroring how
  `ModuleSwitcher` already always shows its own app's module unconditionally
  regardless of what `module_permissions` says. Revisit if a real product
  need for revoking a user's own TES access from inside TES ever shows up —
  it would need a different mechanism (e.g. an admin-only path unaffected by
  the revoked user's own session) to avoid the lockout.

## z) "Log in and check" acceptance criteria need a human, not the agent

1a.23's acceptance criteria included: show the `Set-Cookie` `Domain`
attribute from a login on `app.seaclouds.eu`, and the server-side decoded
`aal` claim on `dcs.seaclouds.eu` after clicking the DCS tile. Neither is
something the agent can ever produce — it has no Timesheet user login for
any real account, on any environment where that matters, and correctly
won't guess, brute-force, or ask a human for one. The read-only Supabase
MCP tools (`execute_sql`, `get_advisors`, etc.) don't reach this either:
`Set-Cookie` is an HTTP response header, and the `aal` claim needs the
JWT actually being issued to a real client through the actual redirect —
neither exists anywhere in Postgres to `SELECT`. `auth.sessions.aal` and
`auth.mfa_amr_claims` are the closest DB-level substitute (used for 1a.23's
verification, with the user's agreement) but only prove aal2 sessions
have existed at some point, not that a specific click today produced one.

For 1a.23 the human (repo owner) performed both steps directly and
reported the results. **Owner: whoever writes the next task with a
"log in as X and observe Y" criterion** — phrase it as a step for the
human to perform and report back (as here), not as agent-verifiable, or
budget time for the human step explicitly rather than have the agent
report a blocked criterion after building everything else.

## aa) Follow-ups noted during DCS 1a.14 (user × project × role matrix screen)

- **Acceptance criterion 4a is unsatisfiable as written, and was flagged to
  the owner before building anything (answer: report as blocked, do not
  touch the policy).** `/dcs`'s project list
  (`apps/dcs/app/(app)/page.tsx`) queries `public.projects` with no filter
  in code, and that table's only SELECT policy is `"Widoczność projektów"`
  (`auth.role() = 'authenticated'`) — inherited from Timesheet, predates
  DCS, and is explicitly out of scope for 1a.14 (no policy edits). Every
  signed-in user sees every project regardless of `dcs.project_roles`, so
  running "the exact query `/dcs` uses" before and after a grant/revoke
  shows the identical full list both times — the query is real, but nothing
  about it changes with the grant.
  **Correction (review, 2026-09-08): the fix is NOT a new/narrower policy on
  `public.projects`.** `"Widoczność projektów"` (`auth.role() =
  'authenticated'`) is shared, load-bearing infrastructure for Timesheet —
  every TES screen that lists or picks a project (admin project list,
  project-assignment checkboxes, sub-project pickers, reports) relies on
  every authenticated employee seeing every project, independent of
  `project_assignments`. Narrowing that one shared policy to
  `is_admin() OR is_project_member(id)` would filter Timesheet's project
  lists too, for every employee who is a TES-only user with no
  `dcs.project_roles` row (i.e. almost everyone on TES today) — a
  cross-module regression, not a DCS-only visibility fix, and squarely
  the kind of shared-schema change `CLAUDE.md`/ADR-0001 warns needs its own
  scrutiny. **The actual fix belongs entirely on the DCS side**: filter in
  `apps/dcs`'s own project-list query (`apps/dcs/app/(app)/page.tsx`) —
  either an inner join against `dcs.project_roles`/`public.project_assignments`
  for the signed-in user, or a `WHERE id IN (...)` built from
  `is_project_member`'s same two sources — so DCS's own screen narrows
  itself without touching the shared policy or Timesheet's behavior at all.
  Scheduled as its own task (application code only, no migration).
- **`public.profiles` SELECT (`auth.uid() = id OR is_admin()`, unchanged)
  means a non-admin DC cannot read their own teammates' names.** The
  project-team page (`/admin/projects/[projectId]`) degrades gracefully —
  falls back to a shortened `id` when `full_name` isn't readable — but for
  a DC session (as opposed to an admin session) this is the common case,
  not an edge case: every teammate but themselves shows as an id. Same root
  cause limits the "add member" picker on that page to whatever profiles
  the viewer's own session can read, which in practice means admin can add
  anyone and a DC can usually add no one new (their own row is already on
  the team). Fixing this needs a policy letting a project member read the
  `profiles` rows of their fellow project members — schema/policy change,
  out of scope here.
- **No discovery path to either new screen beyond a direct URL.** The user
  page (`/admin/users/[userId]`) has no users-list screen to link from
  anywhere in `apps/dcs` (Timesheet's `admin/users/[id]` is reached from
  `admin/users`, which has no DCS equivalent); the project page
  (`/admin/projects/[projectId]`) is reachable by clicking a project name on
  the existing placeholder list (`apps/dcs/app/(app)/page.tsx`, one link
  added). `DcsSidebar` still has its single "Projects" entry — no nav item
  points at either new admin screen. A users-list page was explicitly out
  of scope (extending `app/admin/users` per the task title meant the
  per-user detail page, matching what was in scope for 1a.06's admin
  actions, not a new list screen).
- **`docs/03-conventions.md`'s advisor baseline note ("19 × 0027 + 10 ×
  0029") is stale, unrelated to this task.** Read on scl-dev 2026-09-08
  (before any 1a.14 change): 19 × 0027 but **11** × 0029 — the eleventh is
  `public.is_any_doc_controller()`, added by `dictionaries_dc_write_policy`
  (migration `20260904125543`, DCS 1a.15-adjacent work) without updating
  that note. 1a.14 adds no migration and reads the same 19+11 after the
  work — confirming no new advisory class, per this task's own Verification
  step — but the note itself needs a docs-only fix by whoever touches it
  next.
- **`requireAdminOrDc` (`apps/dcs/lib/project-roles.ts`) does not delegate to
  `requireProjectRole` (`apps/dcs/app/data/actions/auth-helpers.ts`, 1a.12) —
  deliberately, not an oversight.** `requireProjectRole` is a `'use server'`
  function: it always builds its own client via `createClient()` from
  `@scl/db/server` (ignoring any client passed to it) and calls
  `next/headers`-backed cookies through that, so it only runs inside a
  Next.js request — it cannot be called from a Vitest test or a script the
  way `lib/project-roles.ts` is designed to be (see that file's own header
  comment: "runs from a server action... and from a verification script").
  It also throws `ProjectRoleAuthorizationError` rather than returning the
  `ActionResult` every function in `lib/project-roles.ts` returns, and it
  has no admin bypass (a global admin holds no `dcs.project_roles` row, so
  `requireProjectRole(projectId, ['dc'])` alone would wrongly reject an
  admin). Delegating to it would need re-wrapping its throw into
  `ActionResult` AND adding the admin branch outside it anyway, at the cost
  of breaking framework-agnostic testability — so `requireAdminOrDc`
  instead composes that same file's two exported *primitives*
  (`fetchUserProjectRoles`, `hasAnyRole`), which have no Next.js dependency.
  This is composition of shared primitives, not duplicated authorization
  logic — the single source of truth for "does this session hold role X on
  project Y" stays `dcs.project_roles` read through those two functions
  either way.
- **A DC can grant themselves any role on their own project — observed live
  on scl-dev 2026-09-08**: `dcs1a14-dc` self-granted `rev` on SC2602 (PEJ)
  through the real UI, and both `"Doc controllers manage project roles"`
  (RLS) and `requireAdminOrDc` (app) allow it — neither checks whether
  `user_id` in the write equals the session's own id. Allowed by the current
  policy/guard, not a bug in either; separation-of-duties (a DC not being
  able to grant/hold certain roles on their own work, e.g. can't be both DC
  and Approver on the same document) is task **2.08**'s concern, not
  1a.14's — no change made here.
- **Test accounts for this task's scl-dev verification** —
  `dcs1a14-admin@example.com`, `dcs1a14-dc@example.com` (DC of PEJ/SC2602
  only), `dcs1a14-member@example.com` (plain PEJ member) — exist on scl-dev
  (`mzotiurydmhibqhxxzoh`), with the first two enrolled in TOTP (needed to
  clear the aal2 gate as admin/DC). Credentials and TOTP secrets are **not**
  in this repo — kept at
  `~/Desktop/seaclouds/backups/dcs1a14-test-accounts-scl-dev-2026-09-08.txt`
  (chmod 600, same convention as the other files in that directory, e.g.
  `scl-dev-credentials.txt`). Reuse for the **1a.21** demo (owner
  instruction, 2026-09-08) instead of creating new ones.

## bb) Follow-ups noted during DCS 1a.15 (dictionaries screen)

- **`apps/dcs` had no shadcn/ui at all before this task** — no Radix
  dependencies, no `cn()`, no CSS-variable theme, no `components.json`, no
  icon library, despite `CLAUDE.md` naming Timesheet's shadcn setup as "the
  pattern for DCS." The task's own scope asked for a shadcn `Dialog`, so this
  PR brings over the minimal scaffold (matching Timesheet's
  `components.json`/theme token-for-token) plus `Dialog`, `Button`, `Input`,
  `Label`, `Textarea`, `Table`, `Tabs`, `Switch`, `Badge` — the last of these,
  `Tabs`, doesn't exist in Timesheet either, so it's a fresh shadcn-pattern
  component, not a copy. This also closes the icon-library half of
  `deferred-tasks.md` (x) (`lucide-react` is now an `apps/dcs` dependency,
  used by the copied `Dialog`'s close icon) — the mobile-drawer half of (x)
  is still open, unrelated to this task.
- **`tailwind.config` is `.mjs`, not `.js`, in `apps/dcs`** — unlike
  Timesheet, which keeps a `require()`-style `.js` config with the lint rule
  downgraded to a warning (`apps/timesheet/eslint.config.mjs`'s documented
  debt list). `apps/dcs/eslint.config.mjs` explicitly opts out of any rule
  downgrades ("Strict, blocking lint from day one … No rule downgrades
  here"), so the `require("tailwindcss-animate")` the config needs would be a
  lint error, not a warning. Tailwind resolves `.mjs` config files the same
  way, and `apps/dcs/postcss.config.mjs` already uses the ESM form, so this
  follows the app's own existing convention rather than inventing a new one.
- **A dev-mode-only React hydration warning appears on `/admin/dictionaries`
  under `next dev --turbopack`** (Next.js 16.1.1), specifically for a
  non-admin/non-DC session (no `Dialog` mounted, only `Tabs` + `Switch`):
  Radix's internal `useId()`-based `id`/`aria-controls` pair on the tab
  triggers/panels differs between the server-rendered and hydrated markup.
  Verified NOT to reproduce in a production build (`next build && next
  start`, same route, same session) — checked directly against scl-dev
  during this task's live verification, not assumed. Reads as a known class
  of Turbopack-dev + Radix `useId` instability (the dev overlay itself flags
  the Next.js version as stale, 16.1.1 → 16.3.4 available) rather than a
  logic bug in `DictionariesClient`/`DictionaryTypeTable`. No action taken —
  noting it here so a future `next`/Turbopack bump can be checked against it
  rather than it being rediscovered as "new."
- **`getDictionary` renamed to `getActiveDictionary`**
  (`apps/dcs/lib/dictionaries.ts`) to match the name the task brief and
  `docs/02-data-model.md` already used for it. Verified zero callers before
  renaming (grep, 2026-09-09) — 1a.07 shipped the function but nothing had
  called it yet, so this was a same-PR rename, not a breaking change needing
  its own task.
- **No nav link to `/admin/dictionaries` was added** to `DcsSidebar` —
  **PARTIALLY CLOSED 2026-09-16 (DCS 1a.21a).** `DcsSidebar` now carries
  `Dictionaries` and `Clients`, visible to an admin or the DC of any project
  (the same condition as the page guards 1a.21a added to both screens — see
  `docs/03-conventions.md`, „Dostęp do ekranów `/admin` w DCS"). The project
  team screen (`/admin/projects/[projectId]`) got a per-row „Team" link on
  the project list instead of a sidebar entry, shown only to whoever may edit
  that project's team. **Still open: `/admin/users`.** There is no users-list
  screen in `apps/dcs` to link to — only `/admin/users/[userId]` — and
  building one was out of 1a.21a's scope as it was out of 1a.14's. A sidebar
  entry cannot close this one; whoever builds the users list closes it.
  Original text follows.

- **[original]** No nav link to `/admin/dictionaries` was added to
  `DcsSidebar` —
  reachable only by direct URL, same as `/admin/projects/[projectId]` and
  `/admin/users/[userId]` before it (`docs/deferred-tasks.md` (aa): "No
  discovery path to either new screen beyond a direct URL"). Consistent with
  that precedent rather than a new gap; whoever eventually adds DCS nav
  discovery should cover all three at once. **Owner: 1a.21** — `DcsSidebar`
  link to `/admin/dictionaries` (and, while there, `/admin/projects` and
  `/admin/users`, both still nav-less from 1a.14) tracked as one task rather
  than three separate small PRs. **Update (DCS 1a.16):** add
  `/admin/clients` to this same list — same gap, same owner, same reasoning;
  the task's own scope explicitly excluded adding a `DcsSidebar` entry.
- **`meta jsonb` still has no per-type JSON schema / CHECK** (r, above) —
  this task adds exactly one real key (`budget_hours`, `doc_type` only),
  validated at the app layer (`lib/dictionaries-admin.ts`) but not at the DB
  layer. A `colour` key for `workflow_status` (O-05) is still unshaped.
  Unchanged scope decision from 1a.07 — not re-litigated here, just still
  true.
- **`updateDictionaryEntry` writes the full row, not a diff — CLOSED
  2026-09-11 (PR #44, `fix/dcs-dictionaries-diff-only-immutable-code`,
  DCS 1a.15b).** `updateDictionaryEntry` now reads the current row and sends
  only fields that were both provided (`undefined` = "leave alone") and
  actually differ; nothing changed → no UPDATE at all.
  `parseUpdateDictionaryEntryInput` no longer collapses an omitted
  `description` to `null`. Same pattern as `updateClient`, deliberately
  duplicated rather than extracted into a shared helper (see the new entry at
  the end of this section). Proven locally against the real stack: a no-op
  save leaves `updated_at` byte-identical, a label edit writes exactly one
  `audit_log` row (`field_name = 'label'`). Original finding, kept for the
  record:
- **`updateDictionaryEntry` writes the full row, not a diff** — unlike
  `setProjectRoles` (1a.14), which computes granted/revoked sets and issues
  only the rows that actually changed. Confirmed a real correctness gap, not
  just an audit-log-verbosity concern: `parseUpdateDictionaryEntryInput`
  (`lib/dictionaries-admin.ts`) turns an *omitted* `description` into `null`
  (`description ? description.trim() : null`), and the update always sends
  it — so a caller that doesn't pass `description` clears it. Reproduced
  live during this task's own scl-dev verification (the "verification UPDATE
  at 11:51Z" run, which didn't pass `description`): the row's existing
  `"1a.15 verification entry"` description was wiped to `null`, confirmed in
  the printed `updateDictionaryEntry` result. The shipped UI
  (`DictionaryEntryDialog`) always sends `description` from its own form
  state, so this isn't reachable through the screen today — only through a
  caller of the lib function that omits the field, e.g. a future script or a
  narrower future consumer. Fix before 1a.17 reuses this pattern for its own
  dictionary-adjacent writes: read the current row, diff each optional field
  against `undefined` (not against falsy), and write only what changed.
- **Needs owner decision (also asked in this task's own Report):**
  (1) DB-level immutability of `code` — **CLOSED 2026-09-11 (PR #44,
  `fix/dcs-dictionaries-diff-only-immutable-code`, DCS 1a.15b)**: migration
  `20260911091125_dictionaries_code_immutable` adds the `BEFORE UPDATE`
  trigger `dictionaries_code_immutable` →
  `public.forbid_dictionary_code_change()`, raising `23001`
  (`restrict_violation`) whenever `NEW.code IS DISTINCT FROM OLD.code`.
  Unconditional, no admin bypass; `supabase/tests/dictionaries_code_immutable.test.sql`
  proves the refusal for postgres, for an admin session and for a DC at aal2
  (each of which RLS would otherwise let through). Original finding, kept for
  the record: today only the app enforces it
  (`UpdateDictionaryEntryInput` carries no `code` field); a direct
  `PATCH .../dictionaries?id=eq...` with `{"code":"..."}` from a DC's own
  session would succeed against RLS, since the two 1a.09b/1a.11 policies
  never look at which columns changed. A trigger blocking `code` changes on
  UPDATE would close this but is a schema change, out of this PR's scope.
  (2) Whether `workflow_step` should be a visible tab or hidden until the
  workflow engine exists (O-15 is still open) — shipped as a visible tab
  here because the task's acceptance criteria explicitly require a
  screenshot proving all 7 types are present, including `workflow_step`;
  hiding it would have contradicted that criterion. If the owner later
  decides workflow_step editing should wait for the engine, gating the tab
  is a small follow-up (filter one entry out of `DICT_TYPES` for display,
  independent of the DB CHECK list).

### Noted during DCS 1a.15b (the two closures above)

- **`dict_type` is as load-bearing as `code` and still mutable.** The same
  trigger could refuse a `dict_type` change in one more line: the CHECK list
  constrains which values are legal, not whether an existing row may move
  between dictionaries, and a row that silently changes dictionary would
  reassign every document pointing at it. Deliberately left alone — 1a.15b's
  scope named `code` only and explicitly forbade widening it. Tempting,
  unfixed.
- **`updateClient` and `updateDictionaryEntry` are now the same algorithm
  twice.** Both read the row, diff the provided-and-different fields and skip
  the UPDATE when the patch is empty; only the table, the column names and
  the `meta`/`budget_hours` branch differ. A generic
  `diffPatch(current, input, mapping)` would remove the duplication — left
  out on purpose (one task, one PR), and arguably worth waiting for the third
  caller (1a.17) before generalising.
- **The no-op proof cannot be `audit_log`.** `audit_trigger()` logs only
  columns whose value actually changed, so a full-row resend of unchanged
  values produces zero rows — indistinguishable from "no UPDATE was sent".
  `set_updated_at` does fire on every UPDATE, empty payload included, so
  `updated_at` is the only witness. Recorded here because the original
  acceptance criterion assumed the opposite, and the next task to write such
  a proof will hit the same trap.
- **Production is two migrations behind `main` after this PR**
  (`20260909130753_dcs_profile_directory`, `20260911091125_dictionaries_code_immutable`;
  prod read read-only 2026-09-11, latest applied there is `20260904170000`).
  Neither is needed by Timesheet, so this is not an outage — but see (f),
  "Warn when prod migrations lag behind main". No action taken.

## cc) Follow-ups noted during DCS 1a.14b (project list by roles + profile directory)

- **Team table row order is not sorted by name** (`admin/projects/[projectId]/page.tsx`) —
  `memberIds` iterates in whatever order `dcs.project_roles` rows come back
  in (no `ORDER BY` on that query), unlike the "add member" picker, which
  this task did sort by `full_name`. Pre-existing since 1a.14, not
  introduced here; touched adjacent code so it was tempting to fix in
  passing, left alone (one task = one PR). A follow-up would add
  `.order('user_id')` or sort `memberIds` by `displayName()` client-side.
- **The "add member" picker has no search/pagination** — for admin/any-DC it
  now sources the whole directory (this task's own scope decision, ADR-0013),
  which at today's scale (a handful of test/seed accounts) is a short
  `<select>`. Once real headcount lands this will want a searchable combobox;
  not attempted here, no acceptance criterion asked for it.
- **`docs/03-conventions.md`'s advisor baseline note ("19 × 0027 + 10 ×
  0029") is still stale** — already flagged in (aa) as actually 19+11 before
  this task; after this task's migration it is 19+12 (one new
  `SECURITY DEFINER` function, `dcs_profile_directory()`, executable by
  `authenticated`). Not fixed here — same reasoning as (aa): a docs-only fix
  for whoever next touches that file, not this task's job to chase.
- **Blocked on merge, not left unfixed:** the scl-dev-specific acceptance
  criteria (the three-output grant/revoke/re-grant sequence for
  `dcs1a14-member`, the live team-table/picker/audit_log proof as
  `dcs1a14-dc`, and the `get_advisors(security)` **after** reading) all
  require `public.dcs_profile_directory()` to actually exist on scl-dev,
  which only happens once this PR merges to `main` and CI runs
  `db push` (`docs/01-architecture.md`) — not something this session can or
  should shortcut by writing DDL to scl-dev directly (the task's own
  non-negotiable rule: "Migrations go to scl-dev via the normal PR → CI →
  db push path only"). Everything reachable without that dependency — full
  local pgTAP (14 files / 378 tests, including the new
  `dcs_profile_directory.test.sql`'s 21 assertions), Vitest, typecheck,
  lint, and the `get_advisors(security)` **before** reading (19×0027/11×0029,
  read 2026-09-09T13:05:48Z, before any change) — is done and reported.
  Whoever merges this should run the scl-dev proof steps immediately after
  and paste the results into the PR, or ask this session to do it once
  merged.


## ~~dd) 1a.17b — audyt `dcs.mdr_settings`~~ — **zamknięte 2026-09-16**

**Zrobione w 1a.17b** dokładnie w kształcie, który ten wpis zapowiadał: jedna
gałąź we wspólnej funkcji, nie druga funkcja triggera. Migracja
`20260916145603_audit_mdr_settings` robi `create or replace` na
`public.audit_trigger()` zmieniając w ciele **jedną linię** —
`v_record_id := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'project_id')::uuid)`
— i zakłada trigger `audit_mdr_settings`. `project_id` nie wymagał nic:
istniejąca gałąź `elsif v_row ? 'project_id'` rozstrzygała go poprawnie już
wcześniej. Sześć tabel audytowanych wcześniej ma `id`, więc `coalesce` zwraca
dla nich to samo co poprzednie wyrażenie — zachowanie bez zmian.
Rozstrzygnięcie po kształcie wiersza, a nie po nazwie tabeli, było świadomym
wyborem: `if v_table = '…'` zacząłby listę, która rośnie, a przyszła tabela
`dcs.*` kluczowana `project_id` jest teraz audytowana samym `create trigger`.
ADR nie powstał — to jest projekt, który ten wpis i sekcja `public.audit_log`
w `docs/02-data-model.md` już zakładały; zapisany w nagłówku migracji
i w `02-data-model.md` (decyzja właściciela, 2026-09-16).
Test: `supabase/tests/audit_mdr_settings.test.sql` (23 asercje, w tym dowód
czerwony: ze starą funkcją i podpiętym triggerem UPDATE na `mdr_settings`
wywraca się na 23502 `record_id`). Komentarz „AUDITING IS ASYMMETRIC, ON
PURPOSE" w `apps/dcs/components/EditProjectDialog.tsx` przestał być prawdziwy
i został poprawiony w tym samym PR — patrz wpis (jj) niżej.

Oryginalny opis zadania:


Zmiany cykli review, budżetu, `cpy_numbering` i statusu MDR **nie zostawiają
żadnego śladu** w `public.audit_log`. Jedynym świadkiem jest
`mdr_settings.updated_at` (trigger `set_updated_at`), który mówi „coś się
zmieniło o tej godzinie” i nic więcej — nie kto, nie które pole, nie z czego
na co.

Powód jest strukturalny, nie przeoczenie: `public.audit_trigger()` (1a.08)
ma jedno założenie o kształcie tabeli — PK `uuid id`, z którego bierze
`record_id`. `dcs.mdr_settings` ma PK `project_id` i żadnej kolumny `id`,
więc jest świadomie poza listą tabel objętych triggerem (komentarz
w `20260903173128_create_audit_log.sql`, sekcja `public.audit_log`
w `02-data-model.md`). Dopisanie jej wymaga **gałęzi w funkcji**, nie samego
`create trigger` — a to zmiana we wspólnej funkcji audytu dotykająca sześciu
już audytowanych tabel, więc własne zadanie z własnymi testami, nie dokładka
do 1a.17.

Waga: brief §5.2 traktuje cykl 7/10/7 jako atrybut projektu dziedziczony
przez dokumenty, a Faza 2 ma z niego przeliczać daty Planned — „kto skrócił
cykl z 10 na 3 dni” jest pytaniem, które padnie. Zakres zadania:
gałąź w `audit_trigger()` dla tabel z PK innym niż `id` (dla `mdr_settings`
`record_id` = `project_id`, `project_id` = to samo), trigger na
`dcs.mdr_settings`, test w `supabase/tests/audit_log.test.sql` lub własnym
pliku, wpis w liście tabel w `02-data-model.md`. Kryterium wprost wymienione
w 1a.17 jako **poza zakresem** (razem z całym `public.audit_trigger()`).

Udokumentowane w miejscu użycia: komentarz nagłówkowy
`apps/dcs/components/EditProjectDialog.tsx` (sekcja „AUDITING IS ASYMMETRIC,
ON PURPOSE") i test `dcs_create_project_mdr.test.sql` („audit_log has NOTHING
for dcs.mdr_settings").

## ee) Follow-ups noted during DCS 1a.17 (Create Project MDR wizard)

- **`public.projects.project_code` jest niezmienny tylko w aplikacji.**
  `UpdateProjectMdrInput` nie ma takiego pola, a `parseUpdateProjectMdrInput`
  wycina je z surowego payloadu — ale baza wciąż na UPDATE pozwala: polityka
  `Admin zarządza projektami` (ALL, `is_admin()`) nie patrzy na kolumny.
  To dokładnie ta sama luka, którą 1a.15b zamknęło dla
  `dcs.dictionaries.code` triggerem `forbid_dictionary_code_change()`,
  i z dokładnie tego samego powodu (kod jest pierwszym członem numeru
  dokumentu: `SC2601-SCL-RA-0012-EN`). Kusiło, żeby dopisać bliźniaczy
  trigger przy okazji — zostawione: to zmiana w tabeli **produkcyjnej
  Timesheetu**, a `apps/timesheet/.../EditProjectDialog.tsx` ma pole
  `project_code` do edycji i dziś działa. Osobne zadanie musi najpierw
  ustalić, czy TES ma to pole stracić, czy dostać wyjątek.
  **Termin decyzji: przed 1b.02.** Od 1b.02 generator numeracji zaczyna
  wydawać numery `SCYYNN-SCL-…`, których pierwszym członem jest właśnie
  `project_code`. Dopóki nie ma ani jednego wydanego numeru, zmiana kodu jest
  tylko przemianowaniem; po 1b.02 każda taka zmiana unieważnia wstecz numery
  już wydane i rozjeżdża je z `dcs.documents`. Decyzja do podjęcia, nie do
  odłożenia: albo trigger jak w 1a.15b (i TES traci edytowalne pole), albo
  jawny, datowany wyjątek dla TES z uzasadnieniem — ale nie milczenie.
  **Rozstrzygnięte i wykonane w 1a.17c (2026-09-15, PR #48), przed 1b.02:**
  wybrano pierwszą opcję — trigger jak w 1a.15b, bez wyjątku dla TES i bez
  daty ważności. Migracja `20260915081813_project_code_immutable` zakłada
  `projects_project_code_immutable` → `public.forbid_project_code_change()`,
  bezwarunkowo (23001, bez gałęzi dla admina), test
  `supabase/tests/project_code_immutable.test.sql`. TES: pole `project_code`
  w `EditProjectDialog.tsx` jest odtąd tylko do odczytu, a `updateProject`
  buduje payload przez `apps/timesheet/lib/project-update.ts`, który tej
  kolumny nie niesie. Szczegóły w `docs/02-data-model.md`, sekcja
  `public.projects`. Nadal otwarte i poza zakresem 1a.17c: `dict_type` (bb)
  oraz audyt `dcs.mdr_settings` (1a.17b).
- **Rola `view` jest w kreatorze, choć zakres zadania wymieniał pięć ról**
  (ORIG/REV/CHK/APP/DC). Krok „Team and roles" renderuje `PROJECT_ROLES`
  z wygenerowanego enuma (konwencja z `03-conventions.md`: nigdy ręcznie
  wpisana lista), więc pokazuje wszystkie sześć — tak samo jak macierz
  1a.14, która istnieje od tygodnia. Pominięcie `view` tylko tutaj zrobiłoby
  z kreatora wyjątek. Do potwierdzenia przy przeglądzie kreatora.
- **Kreator nie pozwala ustawić `sub_projects.tracking_type`** (zostaje
  `'hours'` z defaultu) ani `projects.description`. Żadnego z tych pól nie ma
  w §9.1 ani w liście pól zadania; `tracking_type` to w dodatku pojęcie TES
  (godziny vs dni w timesheetcie), nie DCS. Dodanie ich to jedna linia
  w każdej warstwie — świadomie niezrobione, żeby nie rozszerzać payloadu
  funkcji bez potrzeby wynikającej z briefu.
- **`docs/03-conventions.md` nadal pisze „19 × 0027 + 10 × 0029"** —
  faktyczny odczyt scl-dev 2026-09-11 to **19 × 0027 + 12 × 0029**.
  Zgłoszone już w (cc); to zadanie nie zmienia baseline'u (funkcja jest
  `SECURITY INVOKER`), więc znowu nie jest to jego poprawka do zrobienia,
  ale liczba w konwencjach myli przy każdym porównaniu.
- ~~**Seed nie nadaje modułu `dcs` zaseedowanemu adminowi**~~ — **zamknięte
  2026-09-16** (follow-up do 1a.18). Logowanie do `apps/dcs` na lokalnym
  stacku wypadało z powrotem przez bramkę modułów w `proxy.ts` na
  `NEXT_PUBLIC_TES_URL` — wyglądało jak zepsuty login, a było brakiem wiersza
  w `public.module_permissions`. Przyczyną była kolejność: backfill w migracji
  `20260904170000` nadaje `dcs` kontom z `role='admin'` **w momencie
  migracji**, a `supabase/seed.sql` wykonuje się po migracjach, więc jego
  użytkownicy dostawali od triggera `grant_default_module_access()` wyłącznie
  `tes`. Poprawione dokładnie tak, jak zapowiadał ten wpis — w seedzie, nie
  w migracji: `insert into public.module_permissions select id, 'dcs' from
  profiles where role = 'admin' on conflict (user_id, module) do nothing` na
  końcu `seed.sql`, tym samym predykatem co backfill. Kształt backfillu z
  1a.22 został nietknięty; żadnej zmiany schematu, triggera ani funkcji.
  Efekt uboczny: `rls_module_permissions.test.sql` opierał się na tym, że
  „nikt jeszcze nie ma DCS" i sam wstawiał adminowi wiersz — teraz byłby to
  duplikat klucza, więc test **asercjonuje** nadanie z seeda zamiast je
  tworzyć (plan 33 → 34). Po `supabase db reset` zaseedowany admin wchodzi na
  `/dcs` bez ręcznego INSERT-a.
- **Atomowości nie da się udowodnić samym pgTAP-em.** `throws_ok` wykonuje
  swoją instrukcję w bloku `exception` plpgsql, czyli w podtransakcji — więc
  granicą rollbacku jest **wywołanie**, nie ciało funkcji, i wewnątrz jednej
  transakcji SQL Postgres daje atomowość również sekwencji czterech
  INSERT-ów. Asercje „zero wierszy po awarii" w
  `dcs_create_project_mdr.test.sql` są prawdziwe i łapią implementację, która
  połyka wyjątek (dowód czerwony wykonany), ale tryb awarii, o który chodzi
  regule z `CLAUDE.md`, to **cztery osobne wywołania PostgREST, każde we
  własnej transakcji**. Ten dowód wykonano skryptem end-to-end i wpisano do
  opisu PR; gdyby ktoś chciał go mieć w CI, wymagałby drugiego połączenia
  (`dblink`) albo testu integracyjnego nad PostgREST-em — dziś nie ma ani
  jednego, ani drugiego.


## ff) Beat 2 DCS 1a.17 — wiersz demo na scl-dev (zostawiony celowo)

Projekt utworzony **przez UI** (kreator Create Project MDR) na scl-dev
2026-09-11, jako `dcs1a14-admin@example.com`, po merge'u PR #46 i zielonym
`deploy-db.yml` (run 34592873062 na `386426d`).

| | |
|---|---|
| `projects.id` | `dc6b9485-7f47-430b-b7ef-262526549b7c` |
| `project_code` | `SC2699` |
| nazwa | DCS 1a.17 Demo — Create Project MDR |
| klient | `TST` (`8e89b365-…`, „1a.16 Verification Client (renamed)") |
| `process_type` / `year` | `project` / 2026 |
| cykl / budżet / status | 7/10/7 · 1200 h · `active` · `cpy_numbering = true` |
| role | `dc` = `dcs1a14-dc@example.com`, `orig` = `dcs1a14-member@example.com` (oba `assigned_by` = admin z sesji) |
| kody CTR | `SC2699_CTR100` (Project management), `SC2699_CTR200` (Survey and reporting) |

Wszystkie siedem wierszy ma identyczny znacznik czasu
`2026-09-11 11:15:46.615155+00` — jedna transakcja, widać to w danych.

**Zostawiony na scl-dev celowo** (materiał demo dla 1a.21, polecenie
właściciela). Kod `SC2699` wybrany świadomie z góry zakresu SCYYNN, żeby nie
kolidować z prawdziwymi projektami importowanymi w **1a.19** — gdyby import
potrzebował akurat `SC2699`, ten wiersz trzeba najpierw usunąć lub
przenumerować, a nie obchodzić.

Konta użyte: te same co w (aa), `dcs1a14-*` — hasła i sekrety TOTP nadal
wyłącznie w `~/Desktop/seaclouds/backups/dcs1a14-test-accounts-scl-dev-2026-09-08.txt`,
nie w repo.

**Uzupełnienie (DCS 1a.21a, 2026-09-16) — dlaczego demo bramki 1a używa
`SC2601`, a nie kolejnego kodu z góry zakresu.** SC2699 wybrano tu z góry
zakresu, żeby nie kolidować z importem 1a.19. Dla `SC2601` rozumowanie jest
inne i prowadzi do odwrotnego wniosku: **SC2601 jest jednym z pięciu projektów,
które już istnieją na prodzie**, a 1a.19 traktuje te pięć jako **UPDATE-only,
nigdy INSERT**. Wiersz devowy `SC2601 · OW_Fishing Support` jest więc tym, co
import spodziewa się zastać, a nie czymś, z czym się zderzy. Decyzja
właściciela, 2026-09-16.

Konsekwencja do zapamiętania: gdyby dry-run 1a.19 na scl-dev kiedykolwiek
**wstawił** SC2601 zamiast go zaktualizować, to jest **błąd importu**, a nie
powód do przenumerowania tego wiersza. `projects.project_code` jest zresztą
niezmienialny od 1a.17c — „przenumerowanie" i tak oznaczałoby skasowanie
wiersza.

Kody użyte przez 1a.21a na scl-dev: `SC2601` (przygotowanie demo, krok 3),
`SC2698` (projekt tworzony na żywo w kroku 4, rezerwa `SC2697`), `SC2690`
(projekt-śmieć z próby generalnej, `1a.21a Rehearsal — delete on request`).
Klient `DEMO · Demo Client` założony w tym samym przebiegu; `TST` nietknięty.


## gg) Follow-ups noted during DCS 1a.17c (`projects.project_code` immutable)

- **Pułapka `FormData`: input z `disabled` nie trafia do `FormData` w ogóle.**
  To wzorzec, nie jednorazowa usterka — powtórzy się przy każdym następnym
  polu „tylko do odczytu" w tej aplikacji. Zrobienie pola nieedytowalnym
  **wyłącznie** w dialogu nie wystarcza i jest gorsze niż nic: `formData.get()`
  zwraca wtedy `null`, a akcja serwera wysyła `null` na kolumnę, która w bazie
  jest `NOT NULL` — czyli zamiast „nie zmieniaj tego pola" wychodzi „wyzeruj
  je". W 1a.17c dotyczyło to `updateProject`, które liczyło
  `(formData.get('project_code') as string)?.trim() || null`; gdyby zmieniono
  tylko `EditProjectDialog.tsx`, każdy zapis projektu kończyłby się błędem
  (23001 z triggera, a bez triggera 23502 z `NOT NULL`). Reguła: pole
  read-only usuwa się **z payloadu**, nie tylko z formularza, a test ma
  sprawdzać nieobecność klucza. `supabase/tests/project_code_immutable.test.sql`
  pilnuje tego od strony bazy (blankowanie daje 23001, nie 23502), a
  `apps/timesheet/lib/project-update.test.ts` od strony aplikacji.
- **`buildProjectUpdate()` to trzeci ręcznie pisany builder payloadu**, obok
  `updateClient` i `updateDictionaryEntry` — czyli nadszedł „trzeci wywołujący",
  na którego czekał wpis w (cc) („arguably worth waiting for the third caller
  (1a.17) before generalising"). Uwaga na różnicę, żeby uogólnienie nie
  wyszło błędne: tamte dwa **różnicują** (czytają bieżący wiersz i wysyłają
  tylko faktycznie zmienione pola, pomijając UPDATE przy pustym patchu),
  a `buildProjectUpdate` tylko **składa** payload z `FormData` i nic nie
  czyta — wspólny jest kształt „jedna funkcja decyduje, które kolumny lecą do
  bazy", nie algorytm. Świadomie nieuogólnione w 1a.17c (jeden temat na PR).
- **pgTAP nie jest w tym repo pełnoprawnym narzędziem przeciwko remote.**
  scl-dev nie ma rozszerzenia `pgtap` i nic go tam nie zakłada: `ci.yml`
  uruchamia `supabase test db` na efemerycznym lokalnym stacku („no remote
  project is touched here"), a `deploy-db.yml` robi wyłącznie `db push` +
  `config push`. Weryfikacja 1a.17c na scl-dev przeszła sztuczką: `create
  extension pgtap` **wewnątrz** transakcji testu — `CREATE EXTENSION` jest
  transakcyjny, więc końcowy `rollback` usuwa je z powrotem i schemat zostaje
  bit-w-bit ten sam (sprawdzone odczytem po fakcie). Tym samym chwytem zrobiono
  dowód czerwony: `drop trigger` wewnątrz tej samej wycofywanej transakcji, więc
  scl-dev ani przez chwilę nie było naprawdę bez triggera. Zrobienie z tego
  normalnej możliwości wymagałoby migracji zakładającej `pgtap` — a ta
  **dojedzie na produkcję**, więc to osobna decyzja. **Nie działać bez zgody.**
- **`public.audit_log` na scl-dev został ręcznie zmodyfikowany dla rekordu
  `a17c0000-0000-4000-8000-000000000099`.** To projekt-jednorazówka (`SC9901`)
  utworzony do surowej weryfikacji SQL w 1a.17c i skasowany po niej; razem
  z wierszem usunięto jego wpisy w `audit_log` (INSERT, dwa zaakceptowane
  UPDATE-y i DELETE) — na wyraźne polecenie, wbrew rekomendacji, żeby ślad
  zostawić. Zapisane tutaj, żeby późniejszy przegląd **nie odczytał tej dziury
  jako awarii triggera audytowego**: `audit_projects` działał poprawnie przez
  cały czas, wpisy powstały i zostały skasowane ręcznie.
  Sama reguła mieszka od teraz w `CLAUDE.md` (sekcja „Baza produkcyjna"), nie
  tutaj: `deferred-tasks.md` nie jest czytane w każdym zadaniu, więc reguła
  zapisana wyłącznie w nim nie dotarłaby do następnego agenta.

## hh) Follow-ups noted during DCS 1a.18 (seed słowników z załączników A/B)

- **`workflow_status` ma etykiety równe kodom w sześciu z dziewięciu
  wierszy** (`IDC` → „IDC", `IFR` → „IFR", …, `IFB` → „IFB"), bo prompt zadania
  podał dokładnie takie nazwy wyświetlane. Obok, w `workflow_step`, te same
  akronimy mają rozwinięcia z glosariusza („Internal Discipline Check",
  „Issued for Review", …, „As-Built"), więc ekran 1a.15 pokazuje dwa różne
  style w sąsiednich zakładkach. Nie „naprawione" w seedzie, bo etykiety
  statusów nie były podane w wersji rozwiniętej, a zmyślanie treści słownika
  jest wyraźnie zabronione. **Rozstrzygnięte przez właściciela przy przeglądzie
  PR #50 (2026-09-16): zostaje jak jest** — jeśli DC zechce rozwinięć, zmienia
  `label` z ekranu 1a.15, bez migracji. Wpis zostaje jako wyjaśnienie, skąd
  bierze się różnica stylu między sąsiednimi zakładkami.
- **`rls_dictionaries.test.sql` nie może już liczyć wierszy na sztywno.**
  Trzy asercje „użytkownik widzi wszystko" porównywały `count(*)` z literałem
  `2`, a sanity-check na wejściu wymagał pustej tabeli („content is seeded by
  1a.18" — dokładnie ten moment nadszedł). Przepisane tak, żeby **nie dokładać
  warunku do zapytania** (`docs/03-conventions.md`: ekran/test filtrujący po
  stronie aplikacji nie dowodzi niczego o politykach): sumaryczna liczba
  wierszy jest odczytywana raz jako `postgres` (RLS-exempt) do tabeli tymczasowej
  `t_all_rows` i to z nią porównują się gołe `count(*)`. Plan testu 59 → 60.
- **Seed wygenerował 77 wierszy w `public.audit_log` z `user_id = NULL`.**
  `audit_trigger()` zadziałał poprawnie — w trakcie `supabase db push` nie ma
  sesji, więc nie ma `auth.uid()`. Odnotowane, żeby nikt nie czytał tego jako
  luki w audycie; te wiersze i tak widzi wyłącznie admin (`project_id` NULL,
  wpis (bb) wyżej).
- **`meta` nadal bez CHECK-a na kształt** (wpis (r) wyżej, powtórzony w 1a.15).
  1a.18 nie dołożyło ani jednego nowego klucza: `budget_hours` na `doc_type`
  i nic poza tym. Obowiązkowy komentarz przy kodzie akceptacji `3` siedzi
  w `description` właśnie dlatego, że klucza `comment_required` nikt nie
  zdefiniował — jeśli logika obiegu (1b) ma go czytać maszynowo, potrzebny
  jest klucz i migracja przenosząca tę informację.
- **Opisy (`description`) były po polsku, a jeden niósł ścieżkę z repo** —
  **poprawione 2026-09-16** migracją
  `20260916104238_dcs_dictionaries_english_descriptions`. 23 glosy `doc_type`
  przyszły z briefu po polsku, obok angielskich `label`, a `acceptance_code`
  3 miał w treści „(docs/00-glossary.md: powrót do Originatora)" — DC nie ma
  drzewa `docs/`. Teksty zastępcze są zatwierdzone przez DC i wpisane
  dosłownie. Migracja jest **osłonięta**: każdy `UPDATE` dopasowuje się do
  dokładnego tekstu z 1a.18, więc wiersz już zmieniony z ekranu 1a.15 nie
  zostaje nadpisany — to odpowiednik `on conflict do nothing` z 1a.18 i ta
  sama zasada (od pierwszego wgrania słowniki należą do DC, brief §5.8).
  Cena: plik jest jednorazowy i na środowisku z dryfem po cichu robi mniej,
  więc czyta się liczbę wierszy, nie kod wyjścia. `dictionaries_seed.test.sql`
  pilnuje teraz obu rzeczy naraz — zero opisów ze ścieżką `docs/`, zero
  z polskimi znakami diakrytycznymi i 23 + 1 tekst przypięte dosłownie
  (diakrytyki same nie wystarczą: `OC`, `TQ`, `XD`, `XW` nie miały żadnych).
  Plan testu 14 → 18.
- **`process_type` (brief B.4: Internal / Tender / Project / Course) nie jest
  słownikiem** i nie został dodany do CHECK-a — zostaje enumem
  `projects.process_type` (decyzja z 1a.05/1a.07). `dictionaries_seed.test.sql`
  pilnuje tego czerwonym przypadkiem, żeby kolejne zadanie nie „dosiało" go
  z rozpędu.

## ii) `supabase db reset` fails on the storage health check after the SQL is done

Observed repeatedly on 2026-09-16 (CLI 2.75.0, macOS/Docker Desktop) while
working the 1a.18 follow-up. `supabase db reset` applies every migration and
runs `supabase/seed.sql` successfully, then fails at the **`Restarting
containers...`** step:

```
Restarting containers...
HTTP GET: http://127.0.0.1:54321/storage/v1/bucket
failed to execute http request: Get "http://127.0.0.1:54321/storage/v1/bucket":
net/http: request canceled (Client.Timeout exceeded while awaiting headers)
error running container: exit 1
```

**The database is correct anyway.** The failure happens after the data work:
on the failing runs `dcs.dictionaries`, `public.module_permissions` and
`public.audit_log` all held exactly what the migrations and the seed had
written. The non-zero exit is the trap — a script that chains
`supabase db reset && …` stops here even though the reset itself did its job.

Not deterministic: a later reset in the same session passed the same probe in
55 ms (`supabase_storage_*` logs, `user_agent: SupabaseCLI/2.75.0`, 200). It
looks like the CLI polls storage too soon after restarting it and gives up
before the container is accepting connections — the container itself is
healthy and answers `/storage/v1/bucket` with 200 seconds later.

Two things sit next to it in this environment and are **not** the cause, but
are worth knowing before anyone debugs this:

- `supabase_edge_runtime_Seaclouds_management_system` has been
  `Exited (255)` for days; `supabase status` reports `imgproxy`,
  `edge_runtime` and `pooler` as stopped services. The reset does not wait on
  any of them.
- A second, unrelated stack (`…_uwxrstbplaoxfghrchcy`) runs alongside on
  **different ports** (kong `54421` vs our `54321`), so this is not a port
  collision. Two full stacks do compete for Docker CPU/IO, which plausibly
  stretches the restart window.

`supabase test db` is unaffected — it exits 0 on a green run (verified); the
`error running container: exit 1` line that appears next to it shows up only
when the tests themselves fail.

Not fixed here because the obvious lever is a CLI upgrade (2.75.0 → 2.117.0
is offered on every invocation), and **the CLI version is pinned**:
`docs/toolchain.md` requires bumping it locally and in `SUPABASE_CLI_VERSION`
in both workflows in one PR, then regenerating
`packages/db/src/database.ts`, because the type-drift check in CI is
sensitive to the generator version. That is a toolchain task with its own
verification, not a side fix inside a data migration. Until then: if a reset
fails only at `Restarting containers`, check the data before assuming the
reset did not happen.

## jj) Follow-ups noted during DCS 1a.17b (audyt `dcs.mdr_settings`)

- ~~**Trzy komentarze w kodzie mówią teraz nieprawdę.**~~ — **poprawione w tym
  samym PR** (decyzja właściciela: PR, który je unieważnia, ma je naprawić).
  Wyłącznie komentarze, zero zmian logiki:
  `apps/dcs/components/EditProjectDialog.tsx` — blok „AUDITING IS ASYMMETRIC,
  ON PURPOSE" zastąpiony przez „BOTH HALVES ARE AUDITED (since 1a.17b)";
  `apps/dcs/lib/project-mdr.ts` — nagłówek `updateProjectMdr`: zachowanie
  „nie wysyłaj pustego UPDATE-a" i cały argument za nim zostają, zmienia się
  **powód** (nie „nie ma audytu", tylko „nie ruszaj `updated_at` bez
  potrzeby"); `supabase/tests/dcs_create_project_mdr.test.sql` — komentarz nad
  sekcją 3.

- **Dowód czerwony dla przypadku no-op nie istnieje i nie może istnieć.**
  Zadanie prosiło, żeby pokazać także asercję no-op jako czerwoną przed
  poprawką. Nie da się: ze starą funkcją i podpiętym triggerem UPDATE, który
  niczego nie zmienia, wstawia **zero** wierszy do `audit_log`, więc nigdy nie
  dochodzi do naruszenia NOT NULL na `record_id` — asercje 10–13 nowego testu
  przechodzą również przed poprawką (zweryfikowane). Czerwony jest dopiero
  pierwszy UPDATE, który coś zmienia (23502). To nie jest luka w teście:
  asercje no-op pilnują filtra `k <> 'updated_at'`, nie rozstrzygania
  `record_id`, i to one wywrócą się, gdyby ktoś ten filtr usunął.

- **`docs/03-conventions.md` nadal pisze „19 × 0027 + 10 × 0029"** — odczyt
  scl-dev z 2026-09-16 to **19 × 0027 + 12 × 0029**, tak samo jak 2026-09-11.
  Zgłoszone w (cc) i (ee), znowu nie poprawione tutaj (polecenie właściciela:
  osobny PR dokumentacyjny). 1a.17b nie zmienia tego baseline'u — nie dodaje
  funkcji ani tabeli, a `create or replace` zachowuje ACL, więc `revoke`
  z 1a.08 nadal trzyma `audit_trigger()` poza lintem 0029.

## kk) Środowisko demo dla klienta — opcje odrzucone w DCS 1a.21a

Demo bramki 1a (2026-09-16) poszło **opcją A**: prowadzący dzieli ekran ze
swojej maszyny, otwiera Preview deployment tego PR-a i loguje się do Vercela
wcześniej, więc ściana logowania jest dla widzów niewidoczna. To jest tanie
i jednorazowe. Przy **powtarzalnych** demach obie odrzucone opcje wracają —
zapisane tu, żeby nie odkrywać ich od nowa.

Stan faktyczny, odczytany z API Vercela 2026-09-16 (projekt `dcs`,
`prj_7DuhcGzn0rYndf62F8fdsNAN3hdY`):

- `ssoProtection = {"deploymentType": "all_except_custom_domains"}` —
  Vercel Authentication chroni **każdy** URL deploymentu poza własną domeną
  produkcyjną. Preview jest więc za ścianą logowania. Projekt Timesheetu
  (`seaclouds-management-system`) nie ma jej wcale — tylko DCS.
- `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` istnieje **wyłącznie** na targecie
  `production`. `getSupabaseCookieOptions()` zwraca wtedy `undefined`
  (`packages/db/src/cookie-options.ts`), czyli ciasteczko sesji jest
  host-scoped. **Konsekwencja: na Preview przełączenie TES → DCS zawsze
  wymaga ponownego logowania**, niezależnie od ściany. Dodanie tam tej
  zmiennej niczego nie naprawi: oba Preview URL-e leżą na `*.vercel.app`,
  które jest na public suffix list, więc żadne ciasteczko nie może objąć obu.
  Bezszwowe przełączenie istnieje tylko tam, gdzie obie aplikacje dzielą
  `.seaclouds.eu` — czyli na produkcji (`app.seaclouds.eu` +
  `dcs.seaclouds.eu`), a ta celuje w prod, nie w scl-dev.

**Opcja B — Protection Bypass for Automation.** Włączyć bypass na projekcie
`dcs` i dać klientowi link
`?x-vercel-protection-bypass=<sekret>&x-vercel-set-bypass-cookie=true`.
Klient otwiera sam, bez konta Vercela; zero zmian w repo. Koszt: sekret
krąży w linku — rotować po demie. Nie naprawia ponownego logowania przy
kroku „przełącz na DCS".

**Opcja D — dedykowane subdomeny dev.** `dcs-dev.seaclouds.eu` +
`tes-dev.seaclouds.eu`, oba wskazujące na scl-dev, oba z
`NEXT_PUBLIC_AUTH_COOKIE_DOMAIN=.seaclouds.eu`. Własne domeny są wyjęte spod
`ssoProtection`, więc klient wchodzi wprost, a przełączanie modułów działa
naprawdę — jedyna opcja, która pokazuje krok 2 takim, jakim jest na
produkcji. Koszt: DNS, domeny i nowe targety zmiennych w dwóch projektach
Vercela, oraz wpis w `additional_redirect_urls` w `config.toml` — a
`docs/03-conventions.md` („Środowiska i deploymenty") trzyma tę listę wąsko
świadomie, więc to nie jest zmiana do przemycenia przy okazji. Osobne
zadanie, nie dopisek do demo.

**Czego nie robić:** wyłączyć `ssoProtection` na projekcie `dcs`. Każdy
Preview każdej nieprzejrzanej gałęzi celuje w scl-dev; zdjęcie ściany
wystawia je wszystkie publicznie, a raz rozesłanych URL-i się nie cofa.

## ll) Follow-ups noted during DCS 1a.21a (demo prep for the 1a gate)

- **`public.sub_projects` (kody CTR) nie ma żadnego triggera — zero śladu
  w `public.audit_log`. Kandydat na zadanie, bez właściciela.** Odczyt
  scl-dev 2026-09-16: `pg_trigger` dla tej tabeli = **0** wierszy
  użytkownika, PK = **`id uuid`**, 7 wierszy danych. Widać to gołym okiem
  w demie 1a.21: kreator Create Project MDR zapisuje projekt, `mdr_settings`,
  role **i** kody CTR w jednej transakcji, a zapytanie z kroku 6 pokazuje
  trzy pierwsze i ani jednego CTR-a. Dziś to tylko luka w narracji „każda
  zmiana jest zapisana"; **od Fazy 5 to problem realny** — raporty
  budżet/CTR liczą się z tych wierszy, więc „kto i kiedy dodał albo zmienił
  kod CTR" przestanie być pytaniem retorycznym.
  Naprawa jest mała i **nie wymaga zmiany funkcji**: `audit_trigger()` po
  1a.17b bierze `record_id` z `coalesce(id, project_id)`, a `sub_projects`
  ma `id` — czyli wystarczy `create trigger audit_sub_projects ... execute
  function audit_trigger()` w migracji, plus test pgTAP w tym samym PR
  (`CLAUDE.md`). **To trzeba zweryfikować przed pisaniem migracji**, nie
  przyjąć z tej notatki.

- **`postgres_logs` na scl-dev NIE zapisuje błędów na poziomie zapytania —
  kryteria akceptacji muszą używać `edge_logs`.** Sprawdzone, nie założone
  (2026-09-16): przy żywej sondzie RLS jedna wizyta na `/` wykonała
  `INSERT` na `dcs.mdr_settings`, który CHECK odrzucił (SQLSTATE 23514,
  widoczne w panelu sondy) — a w `postgres_logs` w tym oknie były wyłącznie
  wpisy `checkpoint`. Gdyby ktoś oparł dowód „sonda zniknęła" na tym logu,
  dostałby fałszywe potwierdzenie: log milczy tak samo przed zmianą i po
  niej. Działa `edge_logs` (strumień PostgREST): przed zmianą
  `POST /rest/v1/mdr_settings` → 2 × 400 w jednej wizycie, po zmianie
  0 przy trzech wizytach, przy niezmienionym `GET`. Uwaga praktyczna:
  `edge_logs` ma kilkuminutowe opóźnienie ingestu — odczyt tuż po akcji
  potrafi zwrócić pustkę, co łatwo wziąć za dowód.

- **`next start` lokalnie zawsze przekierowuje na `localhost:<port>`,
  niezależnie od nagłówka `Host`.** `apps/dcs/proxy.ts` buduje cele
  przekierowań przez `new URL(path, request.url)`, a `request.url`
  w middleware Next 16 niesie origin wewnętrzny, nie ten z żądania
  (sprawdzone curlem z trzema różnymi `Host`: zawsze
  `location: http://localhost:3001/...`). Skutek wyłącznie lokalny:
  przeglądarka wchodząca na `127.0.0.1:3001` dostaje przekierowanie na
  `localhost:3001`, czyli inny origin, i CORS ubija prefetche. Na Vercelu
  host jest zachowany — brama aal2 działa tam poprawnie, co widać po tym,
  że w ogóle przepuszcza po podaniu kodu. **Nic nie zmieniono**: `proxy.ts`
  był poza zakresem 1a.21a, a `request.nextUrl` zamiast `request.url` to
  zmiana warta własnego PR-a i własnego dowodu, nie dopisku przy demie.

## mm) Follow-ups noted during DCS 1a.24 (UI overhaul of `apps/dcs`)

- ~~**Demo step 1 freezes on "Verifying…" — the second factor SUCCEEDS, only
  the redirect after it is lost.**~~ — **CLOSED 2026-09-17 (DCS 1a.25,
  `fix/mfa-verify-navigation`).** The diagnosis below was right and is now
  confirmed at the source, not inferred; the fix is at the bottom of this
  bullet. Original text kept, because the measurements in it are the reason
  the fix could be aimed at the right layer.

  Reproducible 3/3 on a local production build against scl-dev, as the
  presenter performs it: fresh login, click
  **Dictionaries** in the sidebar, type the code, press Verify once. The
  button sits on "Verifying…" for ever and no error is shown.

  What actually happens, measured rather than inferred — the same run on both
  paths:

  | | client-side nav (the presenter's) | full page load |
  |---|---|---|
  | `POST /auth/v1/factors/…/verify` | **200** | 200 |
  | auth cookie after | **aal2** (2959 → 2998 b) | aal2 (2958 → 2999 b) |
  | ends up on | **`/mfa`, stuck** | `/admin/dictionaries` |

  So `challengeAndVerify()` settles, GoTrue issues the aal2 session and
  `@supabase/ssr` writes it to the cookie. Only `router.push(next)` fails to
  move. The session behind the frozen button is fully aal2: typing
  `/admin/dictionaries` renders it, and clicking **Clients** in the sidebar
  goes straight there with no second prompt. **The presenter is not blocked**
  — any click continues — but they stare at a dead button during the exact
  beat step 1 exists to make.

  Likely cause, untested and left for whoever takes the fix: the Next.js
  client router cached the RSC entry for `/admin/dictionaries` on the first
  click, when it resolved to the `/mfa` redirect; `router.push(next)` re-uses
  that cached entry and resolves back to `/mfa`. A full load has no such
  cache. `router.refresh()` is called *after* `push`, so it never clears it
  in time. Candidate fixes are a one-liner either way — refresh before push,
  or `window.location.assign(next)` — but they are auth-flow changes and
  1a.24 was UI-only, so they were deliberately NOT made here.

  **Pre-existing, not caused by 1a.24** — nothing under `app/mfa/` or
  `proxy.ts` changed, and it reproduces the same on both sides of the change.
  **Owner: a separate task, to land BEFORE the 1a gate demo** (owner's
  decision, 2026-09-17). The demo script was deliberately left describing the
  intended behaviour rather than a workaround, so if that task slips, step 1
  shows a frozen button — check this entry first.

  Two corrections to the first version of this entry, both mine, kept
  because the wrong version would send the next reader to the wrong layer:
  it claimed `challengeAndVerify()` "never settles" (it does — 200) and that
  "the only way out is a reload" (a reload of `/mfa` naturally stays on
  `/mfa`, which has no aal guard; that was a bad inference from a bad test,
  not a finding).

  **Confirmed in 1a.25, out of `next@16.1.1`'s own source — three lines, and
  together they are the whole bug:**

  - `client/components/segment-cache/navigation.js`, `navigate()`: looks the
    requested href up in the route cache and, on a fulfilled entry, navigates
    to **that entry's `canonicalUrl`** without asking the server. For the
    entry the sidebar click created, that canonicalUrl *is* `/mfa?next=…`.
  - `client/components/segment-cache/cache.js`, `getStaleTimeMs()`:
    `Math.max(staleTimeSeconds, 30) * 1000` — **a 30-second floor on every
    entry, which no `staleTimes` config can lower.** This is why the entry is
    still fresh when the presenter finishes typing, and it kills the tempting
    "dynamic staleTime is 0, so it can't be a cache" reading.
  - `router-reducer/reducers/refresh-reducer.js`, `refreshReducer()`: calls
    `revalidateEntireCache()` — *"all refreshes purge the prefetch cache"*.
    So `refresh()` was the cure all along; it was simply called one line too
    late.

  **Fix: `window.location.assign(next)`** — the navigation moved into
  `apps/dcs/lib/mfa-navigation.ts` (`navigateAfterMfaVerify`), which
  `app/mfa/page.tsx` now calls instead of `router.push` + `router.refresh`.
  Covered by `lib/mfa-navigation.test.ts`, which walks the presenter's path
  in one context against a model of the gate and of the three cache rules
  above, for all three ways of entering `/mfa` (verified / enrolment /
  pending). Shown red on the old two lines first.

  **Refresh-before-push was the other candidate and was rejected** (owner's
  decision, 2026-09-17). It would have kept the SPA transition, and it goes
  green against the same test — but `refresh()` also starts its own re-fetch
  of the *current* route (`/mfa`) and nothing orders that against the push,
  so a green there proves less than it appears to. The AAL of the session
  has just changed, which changes the answer every server-side guard gives;
  a full document load is what that deserves. Cost, stated plainly: the
  presenter sees one page reload at that beat instead of an instant
  transition.

  **The aal2 gate itself was not touched** — `proxy.ts` is byte-identical,
  and `app/(app)/admin/guards.test.ts` passes unedited.

- **1a.24's demo walk did not actually cover step 1's verify leg, and said
  32/32 anyway.** The walk clicked **Dictionaries**, asserted the redirect to
  `/mfa` — which is what step 1 claims — then closed that browser context and
  took its aal2 session in a fresh one via a full page load. That is exactly
  the path that works, so the hang above survived a "green" walk. Rule for
  the next walk of this script: a step is only walked if it is walked
  end to end, in one context, the way the presenter does it.

- **`dcs1a14-member` carries an UNVERIFIED TOTP factor on scl-dev, created by
  1a.24's own verification walk.** Factor
  `8abe5128-44d9-438d-9d4c-ce2a997789e5`, `status = unverified`,
  `friendly_name = "totp-1789634199280"`, created 2026-09-17T08:36:39.471Z.
  The friendly name is `Date.now()` from `app/mfa/page.tsx`'s auto-enrolment,
  and it decodes to 08:36:39.280Z — 191 ms before the row, so that line
  minted it. Mechanism: while the account still held the stray `dc` role (see
  the SC2699 entry below), the walk's step 7 opened `/admin/dictionaries`,
  `proxy.ts` sent it to `/mfa`, and `MfaPage`'s mount effect enrolled a
  factor because none existed. Only one exists despite several runs, because
  `resolveMfaFactorState` returns `pending` for an existing unverified factor
  and reuses it instead of enrolling again.

  **It changes nothing at step 7**: an unverified factor does not raise AAL
  (that session is `aal1`, `amr` password-only, zero verified factors), and
  the `proxy.ts` gate only fires for an admin or a DC, which this account is
  no longer. Proven directly — the passing walk ran at 08:55:18Z, after the
  factor existed at 08:36:39Z, and step 7 passed in full.

  **Left in place deliberately** — deleting it is an Auth-data change and
  needs the owner's go (not given). **Still in place after DCS 1a.25**, which
  asked about it explicitly and was told to leave it (owner's decision,
  2026-09-17); 1a.25 needed no Auth write to cover the `pending` path. The
  residual risk, if it stays: should this account ever be made a DC or admin
  again, `/mfa` opens in `pending` mode ("You already started setting up…")
  for a secret nobody recorded, and the presenter must click **Start over**.
  Trap worth naming for anyone scripting against `/admin` as a non-enrolled
  DC: merely *visiting* the gate enrols a factor as a side effect.

- **The per-row "Team" link is the one link in the app with no in-flight
  indicator, and a test pins it that way.**
  `apps/dcs/app/(app)/nav.test.ts` asserts that link's children are exactly
  the string `'Team'`, and `useLinkStatus()` only reports from *inside* its
  own `<Link>` — so any sibling indicator there fails a test 1a.24 was
  required not to edit. The click is still acknowledged: it lands on
  `/admin/projects/[projectId]`, whose `loading.tsx` skeleton paints on the
  first frame. Whoever next touches that test can give the link the same
  treatment as the others by matching on the href instead of the children.

- **`AppShell` takes its sidebar as the FIRST CHILD, not as a prop**, for the
  same reason: `nav.test.ts` finds `DcsSidebar` by walking `props.children`
  from the layout's returned tree and never looks at other props, so
  `sidebar={<DcsSidebar/>}` would hide it from that test. Positional children
  is a weak API and exists only to satisfy it. Same story for `SidebarNav`,
  which takes the `<Link>` elements as children and clones them to add the
  active styling rather than rendering them from a list of hrefs. Both are
  worth revisiting together with the point above, in one task that is allowed
  to touch the test.

- **A double submit is stopped by a latch, not by `disabled` — checked, not
  assumed.** Measured on the real build: dispatching five clicks in ONE
  JavaScript task leaves the button reading "Save" with `disabled === false`
  through all five, because React does not commit the re-render between them.
  Without `lib/single-flight.ts` that is five server-action POSTs; with it,
  one. Two traps for whoever writes the next such test: (1) Next.js
  **serialises** server-action requests, so holding the first POST open keeps
  every later one queued in the client and invisible to a request counter —
  the test then passes with the guard removed; answer the request instead of
  holding it. (2) Restoring the source is not enough between a red and a
  green run — `next start` serves the old bundle until you rebuild, which
  silently produced three "green" results from a broken build during this
  task.

- **`isNavItemActive`'s special case for `"/"` was dead code, and only the
  red-proof run showed it.** The first draft branched on `href === '/'`
  before the generic subtree test. Removing that branch changed no test
  result at all, because the generic test appends the separator (`"//"`),
  which is not a prefix of any real path. The branch is gone. Worth
  remembering as a method note: a red proof is not only for confirming a test
  bites — it is also how you find a guard that never did anything.

- **`docs/deferred-tasks.md` (z) held.** The scl-dev timing, the screenshots
  and the demo walk all needed a real signed-in session, which the agent
  cannot obtain on its own. It asked rather than improvising, and the owner
  authorised reading the backups file for this task only. Nothing from it
  reached the repo, the PR or the report. The entry's advice stands: budget
  the human step, or authorise it explicitly up front.

- **A role grant on scl-dev silently broke demo step 7, and it was not this
  task.** `dcs1a14-member` was granted **Document Controller on SC2699** on
  2026-09-17 at 07:11:14Z by the `ADMIN` account (`public.audit_log` id
  `10069ff9-5fb4-4a26-916d-01b3a4a5352a`, IP `44.193.196.105`) — 24 minutes
  before this branch existed. The effect: the "plain employee" of step 7 saw
  **Dictionaries** and **Clients**, was sent to the aal2 gate, and — having
  no TOTP factor — would have landed on 2FA *enrolment* in front of the
  client. Revoked through the app during 1a.24 with the owner's agreement
  (its own `audit_log` row); the account's `orig` role on SC2699 and its
  SC2602 roles were left alone. The general lesson, which is the reason this
  is written down: **the demo's correctness depends on scl-dev rows that
  nothing guards and no test covers.** The 1a.24 walk now checks the persona
  expectations directly, so the next drift of this kind fails loudly instead
  of surfacing on the call.

## nn) Follow-ups noted during DCS 1a.25 (`/mfa` verify navigation)

- **`apps/timesheet/app/mfa/page.tsx` carried BOTH of 1a.25's defects,
  character for character, and was deliberately NOT touched in 1a.25.**
  `apps/timesheet` is **the production app**. Its fix needed **its own PR and
  the repo owner's review before merge** (owner's decision, 2026-09-17) — not
  a symmetric one-liner smuggled into a DCS PR, however tempting the diff
  looked. That PR is DCS 1a.26 (#59), and it closes **defect 2 only**; defect
  1 is still open below. Both defects:

  1. **The frozen navigation.** Line 113 is the same `router.push(next)` /
     `router.refresh()` pair that froze DCS's demo step 1, reached through the
     same aal2 gate in `apps/timesheet/proxy.ts`. Whether it actually bites
     there depends on whether a Timesheet admin reaches `/mfa` by a
     client-side click (poisoned cache entry, hang) or by a full page load
     (works) — **not established, and not guessed at here.** Establish it with
     the measurement in (mm)'s table rather than assuming DCS's result
     transfers.
  2. ~~**`next` is not validated before it is navigated to.**~~ —
     **closed 2026-09-17 by DCS 1a.26 (#59).** `safeNextPath()` was copied
     to `apps/timesheet/lib/mfa-navigation.ts` (copy, not a `@scl/db` leaf —
     owner's decision, 2026-09-17; see the sizing note below for the option
     that was weighed and declined) and wired in front of the `router.push()`
     on what was line 113. All thirteen rejection cases from #57 are
     transcribed into `apps/timesheet/lib/mfa-navigation.test.ts`, including
     the normalisation traps (`\` folded to `/`, tab/LF/CR and leading
     whitespace stripped by the URL parser) that a naive `startsWith('/')`
     check walks straight into.

     **Settled while closing it, since (nn) left it open:** the
     `javascript:` / `data:` vector *is* reachable through `router.push()`,
     not only through DCS's `window.location.assign()`. Read out of the
     installed `next@16.1.1`, four steps: `app-router-instance.js`
     `dispatchNavigateAction()` parses the href against `location.href`;
     `app-router-utils.js` `isExternalURL()` is just `url.origin !==
     window.location.origin`, and an opaque origin is "external";
     `navigate-reducer.js` hands anything external to `handleExternalUrl()`,
     which sets `canonicalUrl = url.toString()` and `mpaNavigation = true`;
     `app-router.js:207` then calls `location.assign(canonicalUrl)`. Same
     sink as DCS, different route to it — so the push/assign difference in
     defect 1 never protected defect 2.

  Note when sizing that PR: `mfa-factor-state.ts` is already duplicated per
  app, so a shared `mfa-navigation` leaf export on `@scl/db` may be a cheaper
  landing than a third copy of the same two decisions. Also that Timesheet is
  on prod — the aal2 gate there guards real admin screens, so the redirect
  question is a live security matter, not only a demo polish one.

- **There is no test for `proxy.ts` anywhere in this repo — in either app.**
  1a.25's brief named "the most recent existing tests for `proxy.ts` and the
  route guards" as the pattern to follow; the guard tests exist
  (`app/(app)/admin/guards.test.ts`), the proxy ones never did. `find . -name
  '*.test.ts'` returns fourteen files and none of them loads `proxy.ts`. What
  actually covers the gate today is that guard test (route level, one layer
  above) plus the aal2 conjunct in the `dcs.dictionaries` RLS policies
  (`20260904160000_dictionaries_dc_aal2.sql`), which is the guarantee that
  survives a direct API call. 1a.25 transcribed the gate's redirect rule into
  its own test model rather than importing `proxy()` — a middleware function
  wants a `NextRequest`, `@supabase/ssr` and env vars, which is a bigger
  harness than that task's minimal diff allowed. **Worth a task of its own**,
  and if one is written, the transcribed rule in
  `apps/dcs/lib/mfa-navigation.test.ts` should be deleted in favour of the
  real thing.

- **The demo script's pinned Preview URL is stale again the moment this
  merges.** `docs/demo/1a21-demo-script.md` pins an immutable deployment of
  commit `d1d1470` and carries its own rule: *"If a later commit touches
  anything under `apps/`, `packages/` or `supabase/`, this line is wrong."*
  1a.25 touches `apps/dcs/`, so it is wrong. It was not updated in that PR
  because the replacement URL does not exist until Vercel has built the merge
  commit — take it from `vercel ls dcs --meta githubCommitSha=<sha>` and
  re-pin, the way 1a.24 did in its own follow-up commit. **Do this before the
  1a gate demo**: presenting from the `d1d1470` deployment means presenting
  the frozen button this task exists to remove.

## oo) Follow-ups noted during DCS 1b.01 (rejestr dokumentów)

Wszystkie poniższe są **świadomymi lukami**, nie przeoczeniami — każda jest
nazwana także w komentarzu migracji
`20260917130035_create_dcs_document_register`.

- ~~**Numeracja jest pilnowana tylko przy UPDATE.**~~ **Zamknięte w całości.**
  Tor SCL zamknęło **1b.02** (migracja
  `20260918085125_scl_doc_number_generator`): `documents_assign_scl_number`
  jest `BEFORE INSERT` i odrzuca podany numer (`23001`), więc reguła żyje
  w bazie, nie w formularzu. Tor CPY zamknęło **1b.03** (migracja
  `20260918092728_dc_only_numbering_on_insert`) — dokładnie tym wzorcem, który
  ten punkt wskazywał: `enforce_dc_only_numbering()` rozgałęzia się na `TG_OP`
  (przy INSERT „zmieniło się" znaczy „jest niepuste", bo nie ma `OLD`),
  `documents_numbering_dc_only` jest teraz `BEFORE INSERT OR UPDATE`, a
  `dcs.revisions` dostało drugi trigger `revisions_numbering_dc_only_insert`
  na `cpy_revision`. Furtka `auth.uid() is null` (migracja, seed, psql,
  `service_role`) działa również przy INSERT.

  **Jedno wyłączenie, świadome:** `scl_revision` **nie jest** pilnowany przy
  INSERT, choć jest przy UPDATE. Kolumna jest `NOT NULL`, więc każdy INSERT
  ją podaje — reguła „niepuste = zmiana" znaczyłaby, że rewizję tworzy
  wyłącznie DC w sesji aal2, wbrew `docs/00-glossary.md` (Originator tworzy
  dokumenty **i rewizje**) i wbrew polityce `"Originators insert revisions"`.
  Insertowa strona `scl_revision` to **generator**, w kształcie, jaki 1b.02
  dało `scl_doc_number`, i należy do **1b.08** — patrz (pp) niżej. Stan jest
  asercją w `supabase/tests/dc_only_numbering_on_insert.test.sql`, nie
  przemilczeniem.
- ~~**Dokument da się utworzyć na projekcie bez wiersza `dcs.mdr_settings`.**~~
  **ZAMKNIĘTE w DCS 1b.04** (2026-09-18, migracja
  `20260918134211_documents_require_mdr_settings`). 1b.01 wskazało tu 1b.02;
  1b.02 świadomie tego nie zrobiło i zostawiło decyzję na 1b.04 — i 1b.04 ją
  podjęło: trigger `documents_mdr_required` (`BEFORE INSERT`, funkcja
  `public.enforce_document_needs_mdr()`) odrzuca 23514 każdy dokument na
  projekcie bez wiersza `mdr_settings`. Test:
  `supabase/tests/documents_require_mdr_settings.test.sql`.

  Trzy rzeczy z tego rozstrzygnięcia, które trzeba znać:
  - **Bez żadnej furtki.** Ani wyjątku `auth.uid() is null` (jak
    `enforce_dc_only_numbering`), ani GUC-a `dcs.import_mode` (jak 1b.02).
    Uzasadnienie: to **fakt o konfiguracji projektu**, nie reguła
    autoryzacyjna, więc odpowiedź nie może zależeć od tego, kto pyta.
    `postgres`, seed i `service_role` też dostają odmowę.
  - **Konsekwencja dla importu SMDR (1b.12–1b.15): import musi najpierw
    założyć MDR projektu, dopiero potem jego rejestr.** Dziś nic tego nie
    przypomina, bo `dcs.documents` na scl-dev jest puste. Jeśli ta kolejność
    okaże się dla importu niewykonalna, poprawką jest **nowa migracja**
    dokładająca gałąź `import_mode`, nigdy edycja tamtej.
  - **Tylko `INSERT`, nie `UPDATE`.** Admin może skasować sam wiersz
    `mdr_settings` (polityka `"Admins manage mdr settings"`), a `ON DELETE
    CASCADE` idzie wyłącznie od `public.projects`. Objęcie UPDATE-u
    znaczyłoby, że dokumenty takiego projektu stają się nieedytowalne —
    łącznie z Voidem, czyli odpowiedzią briefu na dokument, który nie
    powinien istnieć. Reguła, która zamyka dane w pułapce, jest gorsza niż
    luka, którą łata.

  Skutek uboczny w testach, odnotowany, żeby nie czytać go jako regresji:
  `supabase/tests/rls_document_register.test.sql` miało asercję
  „GREEN: a NULL cpy_doc_number is fine on a project with no mdr_settings
  row" — 1b.04 **odwróciło ją** na `throws_ok` i dopisało drugą, pokazującą,
  że ten sam INSERT przechodzi po założeniu wiersza `mdr_settings`.
  `scl_doc_number_generator.test.sql` zakłada teraz taki wiersz dla `SCMS-IT`
  we własnych fixture'ach (potrzebuje tego projektu, bo jako jedyny w seedzie
  ma myślnik w kodzie). `dc_only_numbering_on_insert.test.sql` nie wymagało
  zmian — trigger celowo sortuje się **po** `documents_cpy_numbering`.
- **`originator_id` / `checker_id` / `approver_id` nie muszą mieć roli w
  `dcs.project_roles`.** `docs/02-data-model.md` obiecuje „walidacja w
  bazie"; 1b.01 tego nie dodało, bo wymaga triggera (FK tego nie wyrazi), a
  pola ustawia ekran **1b.04**. Do tego czasu dokument może wskazywać jako
  Checkera kogoś, kto nie ma roli `chk` na tym projekcie — i baza tego nie
  zauważy.

  **1b.04 to obejrzało i świadomie zostawiło otwarte** (decyzja z 2026-09-18).
  Formularz oferuje w rolach ORIG/CHK/APP **wyłącznie osoby mające jakąkolwiek
  rolę na tym projekcie**, ale to jest UX, nie egzekwowanie — bezpośredni
  POST nadal przejdzie. Celowo **nie zawężono** listy do `chk` dla Checkera i
  `app` dla Approvera: dropdown ostrzejszy od reguły w bazie po cichu
  blokowałby obsadę, którą baza przyjmuje. Pytanie, na które trzeba
  odpowiedzieć razem z triggerem, a którego 1b.04 nie miało prawa rozstrzygać
  samo: **czy import SMDR (1b.12–1b.15) potrzebuje tu furtki** — dane
  historyczne niosą obsadę sprzed istnienia `dcs.project_roles`.

  Domknięta natomiast została **jedna** reguła obsady, ta zapisana w
  `docs/00-glossary.md`: Originator ≠ Checker, jako CHECK
  `documents_originator_not_checker` (DCS 1b.04, migracja
  `20260918134210`). Obie kolumny są nullowalne, więc warunek ma jawne
  wyjścia na NULL-e — `is distinct from` odrzucałby dokument bez obsady, a
  takie niesie import. Pary CHK≠APP i ORIG≠APP **nie są** ograniczone: nie ma
  ich w glosariuszu ani w briefie, a CHECK trudno wycofać, gdy dane już są.
- **`ctr_code` można „przenieść" po fakcie.** Trigger
  `enforce_document_ctr_code_project()` sprawdza zgodność projektu przy
  zapisie dokumentu, ale `public.sub_projects.project_id` nie ma żadnej
  blokady niezmienności (w przeciwieństwie do `projects.project_code` po
  1a.17c i `dictionaries.code` po 1a.15b). Przeniesienie kodu CTR do innego
  projektu zostawi dokumenty wskazujące kod obcego projektu. Wersja
  deklaratywna (`UNIQUE (id, project_id)` na `sub_projects` + złożony FK)
  rozwiązałaby to w całości, ale wymaga ALTER-a na produkcyjnej tabeli TES —
  świadomie odrzucone w 1b.01 (ADR-0003), **do rozważenia razem z O-06**.
- **DC może dezaktywować krok obiegu, którego wymaga maszyna stanów.** To
  ryzyko, które O-15 nazwało przy swoim rozstrzygnięciu (patrz
  `docs/04-open-questions.md`): `step_id` jest FK do `dcs.dictionaries`, a
  nic nie broni ustawić `is_active = false` na `IFR`. FK nadal trzyma
  historyczne wiersze, więc to nie jest awaria danych — to znikający krok w
  formularzach. Należy do **Fazy 2** (maszyna stanów), nie do schematu.
- **Polityka admina nie wymaga aal2.** Polityki `"Admins manage documents"`
  / `revisions` / `files` to `FOR ALL` na `is_admin()` bez warunku `aal` —
  dokładnie tak, jak 1a.11 zostawiło politykę admina na `dcs.dictionaries`
  („out of scope for this task, not requested"). Praktyczny skutek: globalny
  admin w sesji aal1 zapisuje te tabele, a numeracji broni już tylko trigger
  (który admina też obowiązuje). To **ta sama luka co w 1a.11**, tylko na
  trzech tabelach więcej — jeśli kiedyś ją zamykamy, to jednym zadaniem dla
  wszystkich polityk admina naraz, nie po jednej tabeli.
- **Dwie polityki DC na `dcs.dictionaries` nadal wiszą w advisorze jako
  `auth_rls_initplan`.** 1b.01 zapisuje warunek jako `((select auth.jwt())
  ->> 'aal')` i tym samym lintu nie dokłada; forma z 1a.11, `(select
  auth.jwt() ->> 'aal')`, jest w advisorze mimo podzapytania. Przepisanie
  tamtych dwóch to jeden `alter policy` × 2 i zdejmuje 2 z 29 ostrzeżeń —
  zbyt małe, żeby wsadzać je do migracji o rejestrze dokumentów.

## pp) Walidacja formatu `scl_revision` — przeniesiona z 1b.02 do 1b.08

Zgłoszone przy DCS 1b.02 (2026-09-18). `dcs.revisions.scl_revision` jest
`NOT NULL` i unikalny w obrębie dokumentu (`UNIQUE (document_id,
scl_revision)`), ale **żadna reguła nie pilnuje jego formatu**: dziś przejdzie
tam dowolny tekst.

Serie zależą od kroku obiegu (`docs/00-glossary.md`): `A, B, …` dla IDC,
`00, 01, …` dla IFR, `1, 2, …` dla rewizji finalnych. Właśnie dlatego nie
jest to `CHECK` — warunek musiałby znać `step_id` wiersza i rozjechałby się
z maszyną stanów przy pierwszej zmianie słownika `workflow_step`.

`docs/02-data-model.md` obiecywało tę walidację „generatorowi (1b.02)".
**To był zły adres** i został poprawiony: 1b.02 nadaje numer *dokumentu*
(`scl_doc_number`, tor `PROJEKT-ORIG-TYPE-SEQ-LANG`) i nie dotyka rewizji
w ogóle. Numer rewizji powstaje tam, gdzie wybierany jest krok — czyli
w **1b.08 (okno New Revision)**. Do tego czasu luka jest otwarta i nazwana.

Uwaga przy realizacji: `revisions_numbering_dc_only` pilnuje, kto może
**zmienić** `scl_revision` (DC tego projektu przy aal2), ale wyłącznie przy
`UPDATE` — strona `INSERT` jest wolna, dokładnie jak była wolna dla
`scl_doc_number` przed 1b.02. **1b.03 świadomie jej nie zamknęło** i zapisało
dlaczego: kolumna jest `NOT NULL`, więc blokada „tylko DC" na INSERT odebrałaby
Originatorowi tworzenie rewizji. Właściwym rozwiązaniem jest generator, nie
blokada — wzorzec do skopiowania jest w migracji
`20260918085125_scl_doc_number_generator`.


## qq) `rls_document_register.test.sql` never runs the number generator

Recorded during the DCS 1b.04 follow-up (PR #67). Nothing here is broken; the
point is that the file's name promises more coverage than the file delivers,
and the next person to read the filename should not be misled.

`supabase/tests/rls_document_register.test.sql` opens 1b.02's import escape
hatch once, near the top, for its whole (rolled-back) transaction:

```sql
set local dcs.import_mode = 'on';
```

Its own comment explains why, and the reason is sound: the file is about 1b.01
— shape, constraints, the four guard triggers and RLS — and its assertions
depend on knowing the numbers, so every INSERT in it supplies `scl_doc_number`
by hand ('VIEW-1', 'ORIG-1', 'DC-AAL2', …) rather than being rewritten around a
generator it does not set out to test.

**The consequence, which was not written down anywhere until now:**
`dcs.next_doc_number` is **never called** in that file, and neither is the
normal path through `documents_assign_scl_number` (the branch where
`scl_doc_number` arrives NULL and the system assigns it). So despite lines that
read like end-to-end coverage — `'GREEN: an ORIG inserts a document at aal1'` —
the file does **not** cover:

- the generator running inside an INSERT, for any caller at all;
- the real client insert path, which is the only one the app uses
  (`apps/dcs/lib/documents.ts` never sends the column, by construction);
- therefore, whether a given role can get a document created *the way the form
  creates one*, as opposed to the way the SMDR import will.

What it does cover stays valid: who RLS admits and refuses, the guard triggers,
the audit attachment, and the numbering columns' two layers.

The gap itself is **closed for the Originator** by
`supabase/tests/rls_documents_originator_insert.test.sql` (1b.04 follow-up),
which sets no hatch, supplies no number, and asserts the hatch is off so the
distinction cannot quietly erode. It is **not** closed for the DC, who inserts
only at aal2 and whose real-path insert is still asserted nowhere.

**Deliberately not fixed here.** Rewriting `rls_document_register.test.sql`
around the generator would mean rewriting assertions that depend on known
numbers across a 107-test file, for a file whose subject is 1b.01. If it is
ever done, the cheaper shape is a second file per role in the manner of the
Originator one, not an edit to that one. Whoever adds the DC case should also
check whether `dc_only_numbering_on_insert.test.sql` has the same shape.
