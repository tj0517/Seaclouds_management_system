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
| `docs/` | dokumentacja kontekstowa — patrz niżej; `docs/tasks/` — backlog zadań DCS |
| `.github/workflows/` | `ci.yml` (PR), `deploy-db.yml` (migracje → scl-dev auto, prod ręcznie) |

## Przed taskiem DCS przeczytaj

1. `docs/00-glossary.md` — pojęcia domenowe (zawsze pierwszy)
2. `docs/01-architecture.md` — stan faktyczny, środowiska, droga migracji
3. `docs/02-data-model.md` — model danych core + `dcs.*`
4. `docs/03-conventions.md` — migracje, RLS, pgTAP, nazewnictwo, PR-y
5. `docs/04-open-questions.md` — punkty otwarte; nie zgaduj rozstrzygnięć
6. `docs/adr/` — podjęte decyzje; `docs/toolchain.md` — przypięte wersje;
   `docs/deferred-tasks.md` — prace odłożone (nie zaczynaj bez zgody)
7. `docs/tasks/DCS-<id>.md` — plik Twojego zadania (źródło prawdy o zakresie,
   kryteriach i decyzjach); tablica: `docs/tasks/INDEX.md`, format: `docs/tasks/README.md`.
   Zadania żyją w repo od 2026-09-22 (wcześniej Notion).

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
- **Nigdy nie kasuj z `public.audit_log` na produkcji.** To dowód wobec
  klienta, nie dane testowe. Reguła jest stała i **przebija zgodę udzieloną
  w trakcie zadania** — jeśli w danym momencie padnie „skasuj", odmów i wskaż
  ten punkt. Na devie kasowanie jest dozwolone, ale sprzątanie musi zostać
  nazwane **w tej samej wiadomości, która prosi o zgodę**, razem z nazwą
  tabeli. Dziura zrobiona ręcznie na scl-dev jest odnotowana
  w `docs/deferred-tasks.md` (gg), żeby nie czytać jej jako awarii triggera.

### Deploy i produkcja

- Merging to `main` deploys to production. `dcs` serves https://dcs.seaclouds.eu
  against the production Supabase project (`tfbzivfsqsgebegcvfah`). Treat every
  merge to main as a production deploy: STOP before merging and get explicit
  approval. A PR that is already merged is closed; commits pushed to its branch
  afterwards trigger no CI and never reach main. Always check
  `gh pr view <n> --json state` before pushing to an existing branch.
- **Timesheet deploys the same way.** Projekt Vercel
  `seaclouds-management-system` (root `apps/timesheet`) ma ten sam production
  branch `main` i serwuje https://app.seaclouds.eu przeciwko **temu samemu**
  projektowi produkcyjnemu Supabase (`tfbzivfsqsgebegcvfah`). Merge do `main`
  ruszający `apps/timesheet` (albo wspólne `packages/`) idzie prosto na
  produkcję Timesheeta — aplikacji, której klient używa na co dzień.
- Oba projekty startują przy każdym pushu i każdym merge'u, ale Vercel bywa,
  że **auto-pomija** build: w checkach PR-a widać to jako
  `Skipped - Not affected`, w dashboardzie jako `CANCELED`. **Kiedy dokładnie
  pomija — nie wiemy;** obserwacje, które nie składają się w regułę (PR #58–#79),
  leżą w `docs/deferred-tasks.md` (aaa), pod otwartym pytaniem. Nic w repo tego
  nie pilnuje i nikt nie dostanie alertu.

  **Konsekwencja praktyczna, niezależna od tego, czego nie wiemy:** nie zakładaj
  ani „to tylko docs, więc nic się nie wdroży", ani „to tylko migracje, więc
  build i tak zostanie pominięty". Przed podaniem URL-a i przed merge'em sprawdź
  faktyczny stan (`gh pr checks`, dashboard Vercela) — z listy zmienionych
  plików tego nie przewidzisz.

  **Zasada zapisu (od PR #79):** wynik CI i Vercela wpisujemy tu wyłącznie dla PR-a
  idącego do merge'a, w jednej linii nadpisywanej przy następnym PR-ze — bez
  kroniki pushów i bez osobnego commita tylko po to, żeby ją dopisać albo zmienić w
  niej hash przy niezmienionym drzewie (każdy taki commit jest kolejnym punktem
  danych, więc kronika nigdy by się nie skończyła). Linia opisuje HEAD PR-a albo
  ostatni commit ruszający `apps/` lub `packages/`, gdy drzewo `apps/` + `packages/`
  w HEAD jest z nim identyczne — i mówi, który z tych dwóch przypadków to jest.
  Kronika obserwacji (PR #58–#79) mieszka w `docs/deferred-tasks.md` (aaa), dopóki
  pytanie jest otwarte; nie kasować jej bez zgody.

  **Ostatni odczyt (jedna linia, nadpisywana):** PR #96 (DCS 1b.24 — Enable DCS dla istniejącego projektu), przed review — opisuje HEAD PR-a `654a29d`; drzewo `apps/` + `packages/` jest w nim identyczne z `39c10c5`, ostatnim commitem PR-a ruszającym `apps/`/`packages/` (`git diff --stat 39c10c5 654a29d -- apps packages` puste, dwa kolejne commity ruszały wyłącznie `docs/tasks/`/`docs/deferred-tasks.md`): `ci` `success` (4m51s); oba projekty Vercel `Skipped - Not affected` (`gh pr checks 96`, 2026-09-25).
- Różnica w ochronie, istotna przy podawaniu URL-i: `dcs` ma
  `ssoProtection = all_except_custom_domains`, więc Preview **i** produkcyjny
  `*.vercel.app` stoją za logowaniem Vercela, a publiczny jest wyłącznie
  `dcs.seaclouds.eu`. `seaclouds-management-system` nie ma ochrony w ogóle
  (`ssoProtection = null`) — tam publiczne są także Preview.

### Schemat i RLS
- Każda tabela `dcs.*` z danymi projektowymi niesie kolumnę `project_id`;
  tabela globalna lub słownikowa (bez `project_id`) wymaga jawnego wpisu
  z uzasadnieniem w `docs/02-data-model.md`. Każda tabela `dcs.*`, bez
  wyjątku: włączone RLS + polityki + test pgTAP — wszystko w tym samym PR.
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
