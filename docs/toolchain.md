# Pinned toolchain

Keep local, CI, and Vercel on the same versions. `packages/db/src/database.ts`
is byte-for-byte generator output, so the CI type-drift check
(`git diff --exit-code` after `supabase gen types`) is sensitive to the CLI
version: a newer CLI in CI than locally turns CI red with no schema change.

| Tool | Version | Pinned where |
|---|---|---|
| Supabase CLI | **2.75.0** | `SUPABASE_CLI_VERSION` in both workflows under `.github/workflows/`; install locally with `npm i -g supabase@2.75.0` (or keep the repo devDependency in sync) |
| Postgres image (local/shadow DB) | **`public.ecr.aws/supabase/postgres:17.6.1.166`** | Indirectly: selected deterministically by the CLI version above. CLI 2.75.0 does not support a `[db] image` key in `config.toml` (verified — parse error), so `config.toml` pins only `major_version = 17`. |
| Node | 20.20.0 | `.nvmrc` (CI reads it via `node-version-file`) |
| pnpm | 10.30.3 | `packageManager` in root `package.json` (CI reads it via `pnpm/action-setup`) |
| Next.js — DCS | **16.2.12** (+ `eslint-config-next` 16.2.12) | exact pins in `apps/dcs/package.json` (DCS 1b.09b: 16.2.0+ carries react/react#35494, the hydration-replay fix — `docs/deferred-tasks.md` ccc) |
| Next.js — Timesheet | **16.1.1** (+ `eslint-config-next` 16.1.1) | exact pins in `apps/timesheet/package.json`; still carries the hydration-replay bug — upgrade is its own task (`docs/deferred-tasks.md` fff) |
| React / React DOM | 19.2.3 | both apps' `package.json`. The App Router renders with the React canary **vendored inside Next** (`next/dist/compiled/react-dom`) — 16.2.12: `19.3.0-canary-3f0b9e61-20260317`, 16.1.1: `19.3.0-canary-f93b9fd4-20251217` |

The two apps pin Next separately on purpose: `@scl/db` declares `next` only as a peer and
DCS compiles it from source (`transpilePackages`), so its `next/*` imports resolve to the
app's own Next (checked in 1b.09b: no 16.1.1 module in the DCS build).

## Upgrading Next.js in DCS

1. Bump `next` and `eslint-config-next` together in `apps/dcs/package.json`; confirm in
   `pnpm-lock.yaml` that `apps/timesheet` still resolves its own version.
2. On a local production build (`docs/03-conventions.md`, "Testy przeglądarkowe"):
   `e2e:hydration-replay` (the guard for this upgrade path), `e2e:profile`, `e2e:pending`,
   `e2e:revision`, `e2e:files`.
3. Update this table and any comment that names the version as current.

## Upgrading the Supabase CLI

One PR that does all of the following, in this order:

1. Bump the version locally and in `SUPABASE_CLI_VERSION` in **both** workflow files.
2. `supabase db reset` + `pnpm db:gen` — regenerate `packages/db/src/database.ts`
   with the new CLI and commit whatever changed.
3. Note the new Postgres image the CLI pulls (`docker ps` → `supabase/postgres:<tag>`)
   and update this file.

Never bump the CLI in CI alone: the drift check will fail for every PR until
local and CI versions match again.
