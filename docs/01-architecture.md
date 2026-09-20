# Architektura — stan faktyczny

Opis tego, co istnieje i działa. Zamierzenia i model danych DCS:
[02-data-model.md](02-data-model.md). Decyzje z uzasadnieniem: [adr/](adr/).

## Monorepo

pnpm workspace + Turborepo ([ADR-0002](adr/0002-monorepo-osobne-aplikacje.md)):

```
scl-portal/
├── apps/
│   ├── timesheet/      @scl/timesheet — SCL-TES, działa na produkcji (Vercel)
│   └── dcs/            @scl/dcs — SCL-DCS, w budowie (Next.js 16)
├── packages/
│   └── db/             @scl/db — typy bazy + fabryki klientów Supabase
├── supabase/           JEDYNY katalog projektu Supabase (config, migrations, seed, tests)
├── docs/               dokumentacja (ten katalog)
└── .github/workflows/  ci.yml (PR) + deploy-db.yml (push migracji)
```

CI pilnuje, że `supabase/` istnieje wyłącznie w rootcie repo.

## Trasy `apps/dcs` (segment `(app)`)

Stan z DCS 1b.07. Wszystkie trasy to async RSC czytające przez sesję
użytkownika — dostęp rozstrzyga RLS, nie kod strony. Poza `/admin` żadna trasa
nie wymaga aal2 (bramka w `proxy.ts` obejmuje wyłącznie prefiks `/admin`), więc
to, czy pole można zapisać, rozstrzyga baza (polityki + triggery), a UI tylko to
odzwierciedla.

| Trasa | Zawartość |
|---|---|
| `/` | lista projektów |
| `/mdr` | rejestr MDR (`dcs.v_mdr`), numer SCL linkuje do profilu |
| `/projects/[projectId]/documents` | dokumenty jednego projektu, numer SCL linkuje do profilu |
| `/documents/new` | formularz nowego dokumentu (1b.04) |
| `/documents/[documentId]` | **profil dokumentu (1b.07)** — po lewej zakładki, po prawej panel bieżącej rewizji |
| `/admin/*` | klienci, słowniki, projekty, użytkownicy (za bramką aal2) |

**Profil dokumentu** (`app/(app)/documents/[documentId]/page.tsx`). Każda zakładka
i panel to osobny komponent w `components/document-profile/`, żeby 1b.09 (pliki)
i 1b.11 (status / Void) podmieniały po jednym pliku (1b.08 zrobiło tak z New
Revision i zakładką Revisions):

- *Information* + zwijane *Additional attributes* — `DocumentInformationTab`;
  jedyny interaktywny element to `CpyNumberField` (klient), zapis przez
  `setCpyNumber` (`lib/documents.ts`, akcja w `app/data/actions/documents.ts`).
  Edytowalne tylko dla DC projektu w sesji aal2 i tylko gdy
  `mdr_settings.cpy_numbering = true` (`cpyFieldMode()` w
  `lib/document-profile.ts` — lustro, nie egzekwowanie: reguły trzymają triggery
  `documents_cpy_numbering` i `documents_numbering_dc_only` oraz polityka
  „Doc controllers update documents”).
- *Panel po prawej* — `CurrentRevisionPanel`: `current_revision_id` →
  `dcs.revisions` + `dcs.files`, wyłącznie odczyt, bez linków do pobrania (1b.09).
  Dokument bez rewizji pokazuje „No revision yet”. **New Revision jest żywym
  dialogiem (1b.08)** dla czytelników, którym baza pozwala (Originator, DC w aal2,
  admin; `newRevisionAccess()` w `lib/revisions.ts` — lustro, nie egzekwowanie);
  dla pozostałych jest wyłączony i mówi dlaczego (dokument Void, brak drugiego
  składnika, brak roli). Pozostałe pięć przycisków jest wyłączone.
- *Revisions* (1b.08) — `RevisionsTab`: historia rewizji dokumentu, najnowsza
  pierwsza (SCL, CPY, krok, powód, data, autor, kod akceptacji, status); wiersz
  rozwija listę plików rewizji (dziś pustą — pliki to 1b.09). Zakładka wybierana
  z URL-a (`?tab=revisions&open=<id>`), bo dialog leży w panelu obok zakładek, a
  po zapisie ląduje się na niej z nowym wierszem rozwiniętym.
- *New Revision* — `NewRevisionDialog` + akcje `proposeRevisionCode` /
  `createRevision` (`app/data/actions/revisions.ts`, logika w `lib/revisions.ts`).
  Kod SCL proponuje baza (`dcs.next_revision_code`); dialog **pomija** kolumnę
  `scl_revision` w INSERT, więc numer nadaje trigger. Wysyła ją wyłącznie DC w aal2,
  który nadpisał propozycję. Pole CPY revision widzi tylko DC (zgodnie z triggerem
  1b.03). Bieżąca rewizja, `NOT_STARTED` → `STARTED` i `SUPERSEDED` na poprzedniej
  to sprawa triggera `revisions_promote_current`, nie akcji.
- *History* — `DocumentHistoryTab`: wiersze `public.audit_log` dla dokumentu i
  jego rewizji, tak jak zwraca je RLS (admin i DC projektu). Pusty wynik nie jest
  błędem, więc stan pusty mówi, że wpisy mogą być niewidoczne dla roli czytającego.
- *Plan / Comments / References / Transmittals* — `PlaceholderTabs`.
- Dokument, którego użytkownik nie może czytać (albo id niebędące uuid-em), daje
  `notFound()` — ta sama odpowiedź co dla nieistniejącego, żeby nie dało się
  sondować istnienia id na cudzym projekcie.

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
   `supabase db push` **i** `supabase config push` na **scl-dev** (token
   scoped tylko do dev; workflow reaguje też na zmiany samego
   `config.toml`). Config push na **prod** pozostaje ręczny i za zgodą
   ([ADR-0007](adr/0007-deploy-bazy-wylacznie-przez-ci.md)).
3. Prod: ręczny `workflow_dispatch` z `main`, za bramką GitHub Environment
   `production-db` (wymagany reviewer). Token prodowy istnieje wyłącznie
   w tym environmencie ([ADR-0005](adr/0005-tokeny-ci-per-projekt.md)).

Uwaga historyczna: do 2026-09-01 punkt 2 był nieprawdziwy — włączona
w dashboardzie integracja GitHub Supabase aplikowała migracje i `config.toml`
na **prod** przy każdym merge'u do `main`, z pominięciem bramki (dotyczyło co
najmniej PR #13 i #15). Integracja jest wyłączona i ma taka pozostać —
[ADR-0007](adr/0007-deploy-bazy-wylacznie-przez-ci.md); skuteczność bramki
udowodniona logami proda 2026-09-01 przy migracji `20260901123548`
(szczegóły i sygnatury: `deferred-tasks.md` l, zamknięte).

Nic nie przypomina o czekającej migracji na prod — patrz
`docs/deferred-tasks.md` pkt f.

Wersje narzędzi (Supabase CLI 2.75.0, Node, pnpm) są przypięte —
`docs/toolchain.md`. Frontend deployowany na Vercel (Root Directory =
`apps/timesheet`; build = `turbo run build` w trybie strict env — zmienne
budowe muszą być zadeklarowane w `turbo.json`).
