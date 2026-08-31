# CLAUDE.md

SCL Portal — monorepo systemów wewnętrznych Sea Clouds: Timesheet (SCL-TES,
na produkcji) i Document Control System (SCL-DCS, w budowie). Wspólna baza
Supabase, prod ref `tfbzivfsqsgebegcvfah`.

## Mapa repo

| Ścieżka | Zawartość |
|---|---|
| `apps/timesheet/` | `@scl/timesheet` — Next.js 16 (App Router, RSC, server actions), działa na Vercelu |
| `apps/dcs/` | planowana aplikacja DCS |
| `packages/db/` | `@scl/db` — typy bazy (`src/database.ts`, generowany — nie edytować) + fabryki klientów |
| `supabase/` | JEDYNY katalog projektu Supabase: `config.toml`, `migrations/`, `seed.sql`, `tests/` (pgTAP) |
| `docs/` | dokumentacja kontekstowa — patrz niżej |
| `.github/workflows/` | `ci.yml` (PR), `deploy-db.yml` (migracje → scl-dev auto, prod ręcznie) |

## Przed taskiem DCS przeczytaj

1. `docs/00-glossary.md` — pojęcia domenowe (zawsze pierwszy)
2. `docs/01-architecture.md` — stan faktyczny, środowiska, droga migracji
3. `docs/02-data-model.md` — model danych core + `dcs.*`
4. `docs/03-conventions.md` — migracje, RLS, pgTAP, nazewnictwo, PR-y
5. `docs/04-open-questions.md` — punkty otwarte; nie zgaduj rozstrzygnięć
6. `docs/adr/` — podjęte decyzje; `docs/toolchain.md` — przypięte wersje;
   `docs/deferred-tasks.md` — prace odłożone (nie zaczynaj bez zgody)

## Komendy

| Komenda | Cel |
|---|---|
| `pnpm install` | instalacja (pnpm workspace) |
| `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck` | przez turbo, wszystkie pakiety |
| `pnpm db:gen` | regeneracja `packages/db/src/database.ts` z lokalnej bazy + typecheck |
| `supabase start` / `supabase db reset` | lokalny stack; baza z migracji + seed |
| `supabase test db` | testy pgTAP z `supabase/tests/` |
| `supabase migration new <opis>` | nowa migracja |

## Reguły nienegocjowalne

### Baza produkcyjna
- MCP Supabase na prod (`tfbzivfsqsgebegcvfah`) jest READ-ONLY: `SELECT`,
  `list_*`, `gen types`. Nigdy `apply_migration` ani DDL przez `execute_sql`.
- Stan proda ustalaj odczytem, nie z pamięci.
- Całe DDL trafia na prod wyłącznie przez pliki w `supabase/migrations/`
  i `supabase db push` (workflow_dispatch za bramką `production-db`).
- Nigdy nie edytuj wypchniętej migracji — poprawka = nowa migracja.
- Konfiguracja projektu (buckety, Auth, SMTP, retencja…) nie przez dashboard —
  tylko migracje lub `supabase/config.toml`. Drift z dashboardu jest
  niewidoczny dla repo i `db diff` (bucket `expense-receipts`: 5 MB
  w migracji, 15 MB na prodzie po ręcznej zmianie).

### Schemat i RLS
- Każda tabela `dcs.*`: kolumna `project_id` + włączone RLS + polityki
  + test pgTAP — wszystko w tym samym PR.
- Rewizje finalne (IFC/IFI/IFB) są niemodyfikowalne przez trigger w bazie,
  nie przez walidację we frontendzie.
- Generator numeracji SCL jest atomowy (blokada w bazie); ręczny wpis numeru
  SCL musi być niemożliwy w każdym formularzu i akcji.

### Kod
- `service_role` nigdy w kodzie klienckim — wyłącznie moduły z
  `import 'server-only'` (CI to egzekwuje).
- `apps/dcs` używa typowanego klienta `@scl/db` z generykiem `<Database>`
  od pierwszego dnia; bez `as any` na zapytaniach.
- Po każdej migracji `pnpm db:gen` i commit — CI odrzuca stale typy.
- Każda zmienna środowiskowa czytana w buildzie musi być w liście `env`
  taska `build` w `turbo.json` (Vercel i CI budują w strict env mode —
  niezadeklarowane zmienne są wycinane). `NEXT_PUBLIC_*` przechodzą same.

## Konwencje aplikacji (Timesheet — wzorzec dla DCS)

- Strony = async RSC pobierające dane przez Supabase; mutacje = server
  actions (`'use server'`) + `revalidatePath()` + `router.refresh()`;
  brak fetchowania po stronie klienta i brak REST-owych route'ów.
- Komponenty klienckie: `'use client'`, PascalCase, obok strony.
- shadcn/ui w `components/ui/` (nie edytować ręcznie), Tailwind + `cn()`.
- Szczegóły i wyjątki: `docs/03-conventions.md`.
