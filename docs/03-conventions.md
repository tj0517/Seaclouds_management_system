# Konwencje

Architektura i droga migracji: [01-architecture.md](01-architecture.md).

## Migracje

- Tworzenie: `supabase migration new <opis>` →
  `supabase/migrations/<timestamp>_<opis>.sql`. Opis snake_case, po angielsku,
  mówi co robi migracja (`create_dcs_schema`, `add_clients_table`).
- **Jedna zmiana = jedna migracja.** Tabela + jej RLS + polityki + triggery to
  jedna zmiana; dwie niezależne tabele to dwie migracje.
- Nigdy nie edytuj migracji, która została już wypchnięta (scl-dev lub prod) —
  poprawka to nowa migracja.
- Struktura vs seed: wszystko, co ma istnieć na remote (tabele, polityki,
  funkcje, **storage buckets**), idzie w migracje. `supabase/seed.sql` to
  wyłącznie dane testowe dla lokalnego stacka i CI — **seed nie wykonuje się
  przy `db push` na remote**.
- Funkcje: `security definer` tylko gdy konieczne i zawsze z przypiętym
  `search_path` (dług w istniejących funkcjach — `docs/deferred-tasks.md` b).
- Po każdej migracji: `pnpm db:gen` (regeneruje `packages/db/src/database.ts`
  + typecheck) i commit wyniku — inaczej CI zatrzyma PR na type-drift check.
  Uwaga: `gen types` obejmuje schematy wystawione w API — dodając schemat
  `dcs`, trzeba dopisać go do `schemas` w `[api]` w `supabase/config.toml`.

## RLS i testy pgTAP

- Każda tabela z danymi projektowymi: `project_id` + `enable row level
  security` + polityki w migracji tworzącej tabelę + test pgTAP **w tym samym
  PR**.
- Wzorzec testu: `supabase/tests/rls_timesheet_entries.test.sql` —
  fixtury jako `postgres` (UUID-y z seeda są losowe, szukaj po e-mailu),
  potem `set local role authenticated` + `request.jwt.claims` dokładnie jak
  PostgREST; `throws_ok` z SQLSTATE `42501` dla odmów.
- Testy uruchamia `supabase test db` na bazie z `supabase db reset`
  (migracje + seed). Nowe scenariusze DCS wymagają danych w seedzie —
  używaj stałych UUID-ów dla obiektów, do których testy odwołują się wprost.
- Minimalny zakres testu tabeli `dcs.*`: członek projektu widzi, nie-członek
  nie widzi, zapis dozwolony tylko dla właściwej roli, zapis zabroniony
  odrzucany.
- Dowód na RLS (test, ekran, demo) jest ważny wyłącznie, gdy zapytanie nie
  zawiera żadnego warunku w kodzie — czysty `select` z tabeli, bez `.eq()`,
  bez embedów `!inner`, bez filtrów. Różnicę zbiorów między użytkownikami
  musi robić sama baza. Ekran, który filtruje po stronie aplikacji, nie
  dowodzi niczego o politykach.

## Advisor — świadomie akceptowane ostrzeżenia

Baseline advisora security: **zero** lintów `function_search_path_mutable`
(0011), `pg_graphql_anon_table_exposed` (0026) i
`anon_security_definer_function_executable` (0028). Utrzymują go migracje
`20260831143840_pin_function_search_path` /
`20260831143841_revoke_anon_and_public_grants` oraz test
`supabase/tests/advisor_grants.test.sql` (pilnuje też domyślnych uprawnień,
żeby nowe tabele nie przywróciły grantów `anon`).

Poniższe ostrzeżenia advisora są akceptowane **świadomie** — nie wykonuj ich
rekomendacji, bo odebranie uprawnień roli `authenticated` wyłączy TES:

- **0027 `pg_graphql_authenticated_table_exposed`** (po jednym na każdą
  tabelę `public`) — PostgREST obsługuje zalogowanych użytkowników właśnie
  jako rolę `authenticated`; bez jej `SELECT` żadne zapytanie aplikacji nie
  zwróci danych. Widoczność wierszy ogranicza RLS, nie granty.
- **0029 `authenticated_security_definer_function_executable`** (po jednym na
  każdą funkcję SECURITY DEFINER) — wyrażenia polityk RLS wykonują się jako
  rola zapytania, więc `authenticated` musi mieć `EXECUTE`: `is_admin()` woła
  m.in. polityka „Admin zarządza projektami” na `public.projects` i polityki
  storage, `is_week_locked(...)` — polityki `timesheet_entries`,
  a `resubmit_rejected` aplikacja przez RPC.
- **`auth_leaked_password_protection`** — otwarte do czasu decyzji o
  konfiguracji Auth (`docs/deferred-tasks.md` b); zmiana wyłącznie przez
  `config.toml`/migrację, nie dashboard.

Uzasadnienie 0027/0029 zweryfikowano odczytem na prod (2026-08-31):
`pg_policy` (wyrażenia polityk wołające te funkcje) oraz
`has_function_privilege('authenticated', …)`. „Pusta lista advisora” nie jest
osiągalnym celem dla tego projektu.

## Nazewnictwo

- Baza: snake_case; tabele w liczbie mnogiej (`documents`, `revisions`);
  enumy z prefiksem domeny tam, gdzie nazwa jest generyczna
  (`dcs_workflow_status`); FK `<obiekt>_id`; polityki RLS nazwane opisowo
  po angielsku (istniejące polskie nazwy w `public` to zastane — nie naśladuj).
- TypeScript: typy wierszy wyłącznie z `@scl/db`
  (`Tables<'documents'>` itd.) — nigdy ręcznie deklarowane interfejsy
  odwzorowujące tabele. Komponenty klienckie PascalCase obok strony,
  server actions w katalogu akcji aplikacji z `'use server'`.
- `apps/dcs`: klient Supabase zawsze z generykiem `<Database>`; zakaz
  `as any` na zapytaniach (dług Timesheet nie przechodzi do DCS).

## PR-y

- Jeden temat na PR; migracja + RLS + test pgTAP + regeneracja typów razem.
- CI musi być zielone (guardy, pgTAP, type-drift, lint, typecheck, build
  w trybie strict env). Nowa zmienna budowa = wpis w `env` w `turbo.json`.
- Merge do `main` automatycznie pcha migracje na scl-dev — nie merguj
  migracji, której nie chcesz jeszcze na scl-dev. Prod wyłącznie przez
  ręczny `workflow_dispatch` (patrz 01-architecture).
- Opis PR: co i dlaczego, plus jak zweryfikowano (wynik `supabase test db`,
  zrzut ekranu dla UI).
