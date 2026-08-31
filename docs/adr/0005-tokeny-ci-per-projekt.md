# ADR-0005 — Tokeny CI scope'owane per projekt, prod za bramką environmentu

## Kontekst

Workflow `deploy-db.yml` pcha migracje na scl-dev (automatycznie po merge do
`main`) i na prod (ręcznie). Repository secrets w GitHubie są czytelne dla
każdego workflow na każdej gałęzi — jeden prod-capable token jako repo
secret pozwalałby dowolnemu workflow ominąć zatwierdzanie wdrożeń
produkcyjnych. Dodatkowo push-triggerowany job prodowy czekający na
approval blokował grupę concurrency i wieszał kolejne deploye dev (bug
naprawiony w PR #8).

## Decyzja

Osobne tokeny Supabase o zasięgu jednego projektu:

- `SUPABASE_ACCESS_TOKEN_DEV` (+ hasło DB dev) — repo secret, umie tylko
  scl-dev; używany przez automatyczny job `push-dev`.
- `SUPABASE_ACCESS_TOKEN_PROD` (+ hasło DB prod) — secret **wyłącznie
  w GitHub Environment `production-db`** z wymaganym reviewerem; job
  `push-prod` odpalany tylko przez `workflow_dispatch` z `main`.

Zrealizowane w PR #7 (scoping tokenów) i PR #8 (rozdzielenie triggerów
i grup concurrency).

## Konsekwencje

- Żaden workflow poza zatwierdzonym runem `production-db` nie ma fizycznie
  poświadczeń do prodowej bazy — bramka jest kryptograficzna, nie umowna.
- Wdrożenie na prod to zawsze świadoma, ręczna decyzja; nic nie przypomina
  o zaległych migracjach (`docs/deferred-tasks.md` f).
- Oczekujący approval prodowy nie blokuje deployów dev (osobne grupy
  concurrency per event).
- Rotacja tokenów odbywa się per projekt; nowe środowisko = nowy token
  o własnym zasięgu, nigdy rozszerzanie istniejącego.

## Data / Status

2026-08-30 (PR #7, PR #8 zmergowane) / przyjęta
