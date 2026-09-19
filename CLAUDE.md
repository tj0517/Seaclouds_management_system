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
  pomija — nie wiemy.** Cztery obserwacje, wszystkie z tego repo, których nie da
  się złożyć w jedną regułę:
  - **PR #58** — nowa gałąź, wyłącznie `docs/` — **zbudował oba projekty**.
  - **PR #64** — nowa gałąź, `supabase/` + `docs/`, bez `apps/`
    i bez `packages/` — **pominął oba** (`Skipped - Not affected`).
  - **PR #65** — nowa gałąź, wyłącznie ten plik (`CLAUDE.md`, nawet nie
    `docs/`) — **zbudował oba projekty** (`Deployment has completed`).
  - **PR #66** (DCS 1b.04, 18.09) — nowa gałąź, **dwa commity, i to one są tu
    najciekawsze**, bo PR trzeba czytać w całości, nie po pierwszym pushu:
    - `7c6a55e` — `apps/dcs/` + `supabase/` (migracje i testy) + `docs/`,
      **bez zmian w `packages/`** (`pnpm db:gen` nie dał diffu) →
      `dcs` **zbudował** (`Deployment has completed`),
      `seaclouds-management-system` **pominięty** (`Skipped - Not affected`).
    - `1c0d558` — wyłącznie `CLAUDE.md` i `docs/03-conventions.md`, czyli
      **ściśle mniej** niż commit wyżej (żadnego `apps/`, żadnego
      `supabase/`) → **oba projekty zbudowały się**
      (`Deployment has completed`).

    **To najostrzejszy punkt danych z tej listy**, bo trzyma stałe wszystko,
    co zwykle się różni — to samo repo, ta sama gałąź, ten sam PR, ta sama
    konfiguracja — i zmienia **wyłącznie commit**. Timesheet pominął commit,
    który ruszył `apps/dcs` i `supabase/`, a zbudował następny, który ruszył
    tylko dokumentację. Kształt jest ten sam co #64 vs #65, tylko tym razem
    bez żadnej różnicy między PR-ami, na którą dałoby się to zrzucić.

    **Wniosek jest negatywny i taki ma zostać: z listy zmienionych plików nie
    da się przewidzieć, które projekty się zbudują.** Żadna z hipotez
    zapisanych w `docs/03-conventions.md` (w tym ta o członkostwie
    w workspace) nie tłumaczy wszystkich czterech obserwacji — `1c0d558`
    ruszył zero pakietów workspace i zbudował oba projekty. **Pytanie
    pozostaje otwarte**; nie wstawiaj tu nowej teorii na miejsce starej,
    dopisuj obserwacje.
  - **PR #67** (follow-up 1b.04, 19.09) — nowa gałąź, `apps/dcs/`
    + `supabase/tests/`, bez `packages/` i bez `apps/timesheet/` → `dcs`
    **zbudował**, `seaclouds-management-system` **pominięty**
    (`Skipped - Not affected`). Ten sam kształt co commit `7c6a55e` z #66;
    obserwacja potwierdza, nie komplikuje.

  Sama „nowa gałąź" więc builda nie wymusza (to zdanie stało tu wcześniej jako
  reguła i jest nieprawdziwe), ale i „mniej zmienionych plików = pominięty
  build" nie działa: #64 ruszył **więcej** ścieżek niż #58 i #65, a zbudował się
  jako jedyny z tamtych trzech **mniej**. Ustalone jest tylko tyle, że
  bazą porównania bywa **ostatni deployment danego projektu**, a nie
  commit-rodzic (`d1d1470`, wyłącznie `docs/`, zbudował się, bo poprzedni
  deployment `dcs` był sprzed `3a08da3`; dwa kolejne commity tylko-`docs/` już
  nie). Sprawdzone w repo: **nie ma tu żadnego `vercel.json` ani
  `ignoreCommand`** — ale to mówi wyłącznie, gdzie mechanizmu NIE ma, i niczego
  nie wyjaśnia. Nic w repo tego nie pilnuje i nikt nie dostanie alertu.

  **Konsekwencja praktyczna, niezależna od tego, czego nie wiemy:** nie zakładaj
  ani „to tylko docs, więc nic się nie wdroży", ani „to tylko migracje, więc
  build i tak zostanie pominięty". Przed podaniem URL-a i przed merge'em sprawdź
  faktyczny stan (`gh pr checks`, dashboard Vercela) — z listy zmienionych
  plików tego nie przewidzisz.
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
