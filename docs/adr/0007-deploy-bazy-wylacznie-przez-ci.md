# ADR-0007 — Deploy bazy wyłącznie przez CI, integracja GitHub Supabase wyłączona

## Kontekst

Repo definiuje jedną drogę zmian na prod: `deploy-db.yml` z ręcznym
`workflow_dispatch` za bramką GitHub Environment `production-db`
([ADR-0005](0005-tokeny-ci-per-projekt.md)). Równolegle jednak na projekcie
prod była włączona — skonfigurowana w dashboardzie, niewidoczna dla repo —
**integracja GitHub Supabase** (mechanizm branchingu). Przy każdym merge'u do
`main` infrastruktura Supabase sama klonowała repo i aplikowała na prod
migracje **oraz** `config.toml` (config sync rozpoznaje blok
`[remotes.production]`), z pominięciem workflow i bramki.

Wykryte 2026-09-01 podczas analizy, jak migracja
`20260901082600_enforce_project_code_format` (PR #15) znalazła się na prodzie,
mimo że job prodowy w CI był `skipped`. Dowód z logów proda:

- `postgres_logs`: sesja `user_name=postgres` z infrastruktury Supabase
  (AWS us-east-1), 08:47:36–37 UTC — sygnatura `db push`
  (`CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations` +
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`), potem statementy migracji.
- `workflow_run_logs`: `Cloning git repo… git_ref=main` →
  `Loading config override: [remotes.production]` →
  `Applying migration… 20260901082600_…` — 30 s po merge'u PR #15.
- Ten sam przebieg dla migracji PR #13 (2026-08-31 15:11) — wzorzec,
  nie jednorazówka.

Konsekwencja: **bramka `production-db` nigdy dotąd nie wykonała realnej
pracy** — integracja zawsze była pierwsza, a ręczne dispatche zastawały prod
„up to date".

## Decyzja

Integracja GitHub Supabase zostaje **wyłączona**. Na prodzie
(`tfbzivfsqsgebegcvfah`) rozłączenie potwierdzone przez właściciela
2026-09-01. Na scl-dev (`mzotiurydmhibqhxxzoh`) integracji nigdy nie było —
`branches list` zwraca pustą listę (odczyt 2026-09-01), podczas gdy prod ma
rekord brancha domyślnego powiązanego z `git branch main` od 2026-06-08; nie
powstały żadne branche per-PR (płatne na planie Pro), które trzeba by
sprzątać. Jedynym kanałem zmian schematu i konfiguracji na
remote pozostaje `deploy-db.yml`: merge do `main` → push na scl-dev
automatycznie; prod → ręczny `workflow_dispatch` za bramką `production-db`.
Ponowne włączenie integracji unieważnia cały ten proces i wymaga rewizji
tego ADR.

## Konsekwencje

- Bramka `production-db` staje się faktyczną, a nie tylko zapisaną, kontrolą —
  ale jej skuteczność trzeba dopiero **udowodnić** przy najbliższej migracji
  odczytem logów proda (`docs/deferred-tasks.md` l): DDL ma pochodzić
  wyłącznie z runu `deploy-db.yml`, nie z infrastruktury Supabase.
- Migracje zmergowane do `main` przestają samoczynnie lądować na prodzie —
  wraca problem „nic nie przypomina o czekającej migracji"
  (`docs/deferred-tasks.md` f), teraz już realny, nie teoretyczny.
- `config push` na prod znów wykonuje się tylko ręcznie i za zgodą —
  tak jak założył PR #14.
- To kolejny przypadek klasy „konfiguracja w dashboardzie niewidoczna dla
  repo" (po buckecie `expense-receipts` i leaked-password protection);
  stan integracji nie jest reprezentowalny w repo, więc jego utrzymanie
  to dyscyplina operacyjna, nie kod.

## Data / Status

2026-09-01 / przyjęta
