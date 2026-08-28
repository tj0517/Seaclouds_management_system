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

## Upgrading the Supabase CLI

One PR that does all of the following, in this order:

1. Bump the version locally and in `SUPABASE_CLI_VERSION` in **both** workflow files.
2. `supabase db reset` + `pnpm db:gen` — regenerate `packages/db/src/database.ts`
   with the new CLI and commit whatever changed.
3. Note the new Postgres image the CLI pulls (`docker ps` → `supabase/postgres:<tag>`)
   and update this file.

Never bump the CLI in CI alone: the drift check will fail for every PR until
local and CI versions match again.
