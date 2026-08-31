# Architektura — stan faktyczny

Opis tego, co istnieje i działa. Zamierzenia i model danych DCS:
[02-data-model.md](02-data-model.md). Decyzje z uzasadnieniem: [adr/](adr/).

## Monorepo

pnpm workspace + Turborepo ([ADR-0002](adr/0002-monorepo-osobne-aplikacje.md)):

```
scl-portal/
├── apps/
│   ├── timesheet/      @scl/timesheet — SCL-TES, działa na produkcji (Vercel)
│   └── dcs/            (planowana — część 2 zadania DCS 1a.00b)
├── packages/
│   └── db/             @scl/db — typy bazy + fabryki klientów Supabase
├── supabase/           JEDYNY katalog projektu Supabase (config, migrations, seed, tests)
├── docs/               dokumentacja (ten katalog)
└── .github/workflows/  ci.yml (PR) + deploy-db.yml (push migracji)
```

CI pilnuje, że `supabase/` istnieje wyłącznie w rootcie repo.

## `packages/db` — jedyne źródło typów

- `src/database.ts` — bajt-w-bajt wynik `supabase gen types typescript --local`.
  Nigdy nie edytować ręcznie; regeneracja: `pnpm db:gen`. CI odrzuca PR, w którym
  plik nie zgadza się z migracjami (type-drift check).
- Wejścia pakietu: `@scl/db` (same typy), `@scl/db/client` (przeglądarka),
  `@scl/db/server` (RSC / server actions; ciągnie `next/headers`, dlatego nie
  jest re-eksportowany z głównego wejścia).
- Klient przeglądarkowy jest dziś **nietypowany** (dług Timesheet,
  `docs/deferred-tasks.md` pkt d). `apps/dcs` używa generyka `<Database>`
  od pierwszego dnia — reguła w `CLAUDE.md`.
- Klucz `service_role` nie występuje w pakiecie; klient admina żyje w aplikacji
  z `import 'server-only'`. CI blokuje pliki z `SERVICE_ROLE` bez `server-only`.

## Baza: schemat `dcs` obok `public`

Jedna baza Postgres (jeden projekt Supabase) dla wszystkich modułów portalu.
Brief zakłada schemat `core`; w praktyce rolę core pełnią istniejące tabele
TES w `public` ([ADR-0001](adr/0001-reuzycie-tes-jako-core.md)):

- `public.profiles` (+ `auth.users`) — użytkownicy i logowanie,
- `public.projects` — wspólny rejestr projektów (`project_code` = numer SC…),
- `public.sub_projects` — kody CTR (per projekt, FK `project_id`).

Nowe tabele DCS trafią do osobnego schematu `dcs` w tej samej bazie
([ADR-0003](adr/0003-osobny-schemat-dcs.md)) i odwołują się do `public`
wyłącznie przez klucze obce. Schemat `dcs` **jeszcze nie istnieje** — powstanie
w Fazie 1a przez migracje.

## Trzy środowiska i droga migracji

| Środowisko | Ref | Rola |
|---|---|---|
| lokalne | `supabase start` / `db reset` | rozwój; baza odtwarzana z `supabase/migrations` + `seed.sql` |
| scl-dev | `mzotiurydmhibqhxxzoh` | integracja; osobny projekt Supabase ([ADR-0004](adr/0004-scl-dev-osobny-projekt.md)) |
| prod | `tfbzivfsqsgebegcvfah` | produkcja; dane nie są kopiowane do dev |

Droga zmiany schematu:

1. Migracja w `supabase/migrations/` + test pgTAP → PR → CI (lokalny stack,
   `db reset`, `supabase test db`, type-drift, lint, build).
2. Merge do `main` → workflow `deploy-db.yml` automatycznie robi
   `supabase db push` na **scl-dev** (token scoped tylko do dev).
3. Prod: ręczny `workflow_dispatch` z `main`, za bramką GitHub Environment
   `production-db` (wymagany reviewer). Token prodowy istnieje wyłącznie
   w tym environmencie ([ADR-0005](adr/0005-tokeny-ci-per-projekt.md)).

Nic nie przypomina o czekającej migracji na prod — patrz
`docs/deferred-tasks.md` pkt f.

Wersje narzędzi (Supabase CLI 2.75.0, Node, pnpm) są przypięte —
`docs/toolchain.md`. Frontend deployowany na Vercel (Root Directory =
`apps/timesheet`; build = `turbo run build` w trybie strict env — zmienne
budowe muszą być zadeklarowane w `turbo.json`).
