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
rekomendacji, bo odebranie uprawnień roli `authenticated` wyłączy TES.
**Przyjęty baseline (scl-dev, odczyt 2026-09-19 12:51Z, stan po DCS 1b.04):
22 × 0027 + 12 × 0029**, nic innego — bez zmian względem odczytu
2026-09-18 08:06Z (stan po 1b.01 + 1b.01a); poprzednio 19 × 0027 (odczyt
2026-09-15, stan po DCS 1a.17c), a trzy nowe to `dcs.documents`,
`dcs.revisions` i `dcs.files`, rejestr dokumentów z 1b.01, czytany przez
każdego członka projektu.

**0029 nie urosło**: cztery funkcje triggerowe
1b.01 są SECURITY INVOKER i żadna rola API nie ma na nie `EXECUTE`
(sprawdzane przy `CREATE TRIGGER`, nie przy wykonaniu). Historia liczby 12:
0029 urosło z 10 o `public.is_any_doc_controller()` (1a.09b)
i `public.dcs_profile_directory()` (1a.14b); zgłoszone jako
`docs/deferred-tasks.md` (cc). 19. lint 0027 to `public.module_permissions`
(1a.22): każdy użytkownik czyta własne wiersze (polityka "Users read own
module permissions"), więc `SELECT` dla `authenticated` jest zamierzony i
nie wolno go odbierać, żeby uciszyć ostrzeżenie — dokładnie ten sam wzorzec
co `dcs.dictionaries` w 1a.07. Każde zadanie porównuje odczyt advisora z tą
liczbą; zmiana = nowa tabela czytana przez `authenticated` (+1 × 0027) lub
nowa funkcja SECURITY DEFINER wołana z polityk (+1 × 0029) i musi być
nazwana w PR, a baseline tutaj zaktualizowany. Uwaga: 1a.22 dodaje też
`public.grant_default_module_access()` (SECURITY DEFINER), ale jak
`audit_trigger()` to czysta funkcja triggera bez `EXECUTE` dla żadnej roli
API (EXECUTE jest sprawdzane przy `CREATE TRIGGER`, nie przy wykonaniu) —
nie liczy się do 0029.

**DCS 1b.05 podniesie 0027 do 23.** `dcs.v_mdr` jest widokiem z `SELECT` dla
`authenticated`, a lint 0027 liczy także widoki — jego opis wymienia je wprost
(„tables, views, materialized views, and foreign tables"). Powód jest ten sam
co przy każdej pozycji na tej liście i tak samo zamierzony: bez `SELECT` dla
`authenticated` rejestr nie zwróciłby nikomu ani wiersza, a widoczność wierszy
ogranicza RLS (`security_invoker`), nie granty. To liczba **przewidziana, nie
zmierzona** — migracji nie ma jeszcze na scl-dev (trafia tam przy merge'u do
`main`), więc dopiero pierwszy odczyt po merge'u czyni ją faktem i wtedy trzeba
ją tutaj potwierdzić. 0029 się nie rusza: widok nie jest funkcją.

- **0027 `pg_graphql_authenticated_table_exposed`** (po jednym na każdą
  tabelę `public`/`dcs` z `SELECT` dla `authenticated`; 22 = 14 tabel TES/core
  + `dcs.mdr_settings`, `dcs.project_roles`, `public.audit_log`,
  `dcs.dictionaries`, `public.module_permissions`, `dcs.documents`,
  `dcs.revisions`, `dcs.files` — w odczycie rozkłada się to na 16 tabel
  `public` i 6 `dcs`) — PostgREST
  obsługuje zalogowanych użytkowników właśnie jako rolę `authenticated`; bez
  jej `SELECT` żadne zapytanie aplikacji nie zwróci danych. Widoczność
  wierszy ogranicza RLS, nie granty.
- **0029 `authenticated_security_definer_function_executable`** (po jednym na
  każdą funkcję SECURITY DEFINER; 10 = 7 funkcji TES + `is_project_member`,
  `has_project_role`, `is_doc_controller` z 1a.09) — wyrażenia polityk RLS
  wykonują się jako rola zapytania, więc `authenticated` musi mieć
  `EXECUTE`: `is_admin()` woła m.in. polityka „Admin zarządza projektami”
  na `public.projects` i polityki storage, `is_week_locked(...)` — polityki
  `timesheet_entries`, a `resubmit_rejected` aplikacja przez RPC. Trzy
  funkcje 1a.09 są tej samej kategorii co `is_admin()`: project-scoped,
  zwracają wyłącznie boolean o uprawnieniach wołającego (`auth.uid()`),
  nie ujawniają danych i nie mutują niczego.
- **`auth_leaked_password_protection`** — **rozstrzygnięte 2026-08-31**:
  ochrona przed skompromitowanymi hasłami (HaveIBeenPwned) jest włączona
  ręcznie w dashboardzie na obu projektach (scl-dev i prod). To **świadomy,
  datowany wyjątek** od reguły „konfiguracja nie przez dashboard”. Powód:
  CLI 2.75.0 nie ma dla tej flagi klucza w `config.toml` — dekoder `[auth]`
  odrzuca `enable_leaked_password_protection` oraz `password_hibp_enabled`
  („invalid keys”), a flagi nie ma w referencji CLI. Odrzucone alternatywy:
  podbicie wersji CLI (przypięcie determinuje obraz Postgresa i wymusiłoby
  regenerację typów — nieproporcjonalne do jednej flagi) oraz jednorazowy
  skrypt do Management API. Funkcja dostępna, bo organizacja jest na planie
  Pro. **Warunek wygaśnięcia wyjątku:** przenieść ustawienie do `config.toml`,
  gdy CLI zacznie obsługiwać ten klucz — patrz `docs/deferred-tasks.md` (h).

### Advisor performance — baseline

Advisor wydajnościowy nie miał tu baseline'u do DCS 1b.01, która podniosła
dwa linty o liczbę wynikającą wprost z przyjętych wzorców. **Przyjęty
baseline (scl-dev, odczyt 2026-09-19 12:51Z, stan po 1b.04; kolumna „było"
to odczyt 2026-09-18 08:06Z po 1b.01 + 1b.01a):**

| Lint | Poziom | Liczba |
|---|---|---|
| `multiple_permissive_policies` | WARN | 223 |
| `auth_rls_initplan` | WARN | 29 |
| `unused_index` | INFO | 22 (było 25) |
| `unindexed_foreign_keys` | INFO | 10 |
| `auth_db_connections_absolute` | INFO | 1 |

- **`multiple_permissive_policies`** zgłasza się raz na każdą kombinację
  (tabela, rola, akcja) obsłużoną przez więcej niż jedną politykę permissive —
  przy sześciu rolach Postgresa daje to 18–24 wpisy na tabelę (`dictionaries`
  18, `mdr_settings` 24, `project_roles` 24, każda z trzech tabel 1b.01 po 18).
  Każda tabela `dcs.*` zbudowana we wzorcu „polityka admina `FOR ALL` +
  polityki ról" dokłada kolejne; 1b.01 dołożyło 54 i baseline wzrósł ze 169.
  Odrzucona alternatywa: jedna polityka na akcję z `is_admin() or …` w środku
  — zeruje lint, ale łamie wzorzec wszystkich istniejących tabel i odbiera
  możliwość `alter policy` na pojedynczej komendzie, na której oparło się
  1a.11.
- **`unused_index`** — **17 z 22 wpisów to indeksy trzech tabel rejestru**
  (`dcs.documents` 8, `dcs.revisions` 6, `dcs.files` 3); pozostałe 5 są zastane
  (`dcs.dictionaries` 1, `public.projects` 1, `public.expense_entries` 2,
  `public.user_monthly_earnings` 1). Advisor mówi tu wyłącznie „scl-dev jeszcze
  z tego indeksu nie skorzystał", co dla tabeli z jednym wierszem jest niemal
  tautologią — nie usuwaj ich, dopóki rejestr nie ma danych i realnego ruchu.

  **Liczba SPADŁA z 25 na 22 między 2026-09-18 a 2026-09-19** i nie zrobiła
  tego żadna migracja: trzy indeksy na `dcs.documents` (z 11 zostało 8)
  zaczęły być używane, gdy ekrany 1b.04 zaczęły tę tabelę czytać. Spadek jest
  po dobrej stronie i nikt go nie „naprawiał" — odnotowany, żeby następny
  odczyt nie czytał różnicy wobec 25 jako regresji. **DCS 1b.05 doda z powrotem
  jeden** (`documents_search_idx`): indeks trigramowy pod wyszukiwarkę
  rejestru, którego planista przy jednym wierszu nigdy nie wybierze — i to jest
  oczekiwane, patrz nagłówek migracji `20260919123436_create_mdr_register_view`
  z pomiarem progu (~20 000 wierszy).
- **`unindexed_foreign_keys`** wróciło do zastanych 10 po 1b.01a. Wszystkie
  dziesięć to TES/core plus `dcs.project_roles.assigned_by`; **żaden nie
  dotyczy tabel rejestru dokumentów**. Pilnuje tego asercja w
  `supabase/tests/rls_document_register.test.sql`, która porównuje pełną listę
  kolumn klucza obcego z wiodącymi kolumnami indeksu — 1b.01 miała tu asercję
  słabszą niż advisor (tylko pierwsza kolumna), przez co przepuściła
  jedenaście złożonych kluczy i lint skoczył chwilowo do 21.
- **`auth_rls_initplan`** stoi na 29 od 1a.22; 1b.01 nie dołożyła nic, bo
  warunek `aal2` jest tam zapisany jako `((select auth.jwt()) ->> 'aal')`.
  Dwa z 29 wpisów to polityki DC na `dcs.dictionaries` z 1a.11, zapisane jako
  `(select auth.jwt() ->> 'aal')`, którą to formę advisor mimo podzapytania
  nadal zgłasza — `docs/deferred-tasks.md` (oo).

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

## Dostęp do ekranów `/admin` w DCS

Trzy warstwy, w tej kolejności, i tylko pierwsze dwie są egzekwowaniem:

1. **RLS** — ostatnia linia obrony, jedyna, która przeżywa bezpośrednie
   wywołanie API. Niezmieniana przez decyzje z tej sekcji.
2. **Guard strony (RSC)** — `redirect('/')` na początku strony, zanim
   powstanie jakikolwiek JSX. Plus bramka aal2 po prefiksie `/admin`
   w `apps/dcs/proxy.ts` (1a.11 / O-14), która dotyczy wyłącznie sesji
   admina lub DC.
3. **Widoczność linku** (`DcsSidebar`, link „Team" w wierszu listy
   projektów) — wyłącznie nawigacja. Nigdy nie traktuj „link się
   wyrenderował" jako autoryzacji; `<IfRole>` mówi to samo.

Reguła: **widoczność linku musi odpowiadać guardowi strony, do której
prowadzi** — widoczny link nigdy nie kończy się przekierowaniem, a ukryty
nigdy nie chowa osiągalnej strony. Obie decyzje liczy jedna funkcja
(`canOpenAdminScreens` / `isAdminOrAnyDc` w `apps/dcs/lib/auth-helpers.ts`),
złożona z prymitywów `fetchUserProjectRoles` + `hasAnyRole`, a nie osobne
zapytanie.

Stan po **DCS 1a.21a** (zmiana zachowania — wcześniej `/admin/dictionaries`
i `/admin/clients` renderowały się każdemu zalogowanemu użytkownikowi):

| Ekran | Guard strony | Prawo edycji w środku | Link w `DcsSidebar` |
|---|---|---|---|
| `/admin/dictionaries` | admin lub DC dowolnego projektu | to samo (`requireAdminOrAnyDc`) | tak, ten sam warunek |
| `/admin/clients` | admin lub DC dowolnego projektu | **tylko admin** (`requireAdmin`) | tak, ten sam warunek |
| `/admin/projects/new` | brak (komunikat dla nie-admina) | admin | nie — wejście z listy projektów |
| `/admin/projects/[projectId]` | brak (każdy członek projektu czyta zespół) | admin lub DC **tego** projektu | nie — link „Team" w wierszu, ten sam warunek co edycja |
| `/admin/users/[userId]` | admin (`redirect('/')`, 1a.14) | admin | nie — ekranu listy użytkowników nie ma |

Guard szerszy niż prawo edycji to norma, nie błąd: DC musi czytać klientów
(numeracja CPY), więc wchodzi na `/admin/clients` i widzi je w trybie tylko
do odczytu. Odwrotność — prawo edycji szersze niż guard — jest błędem.

Kierunek degradacji przy nieudanym odczycie `dcs.project_roles`:
**zamknięty** (jak `resolveProjectListFilter`, w przeciwieństwie do
`fetchMyModuleAccess`, które celowo degraduje otwarcie — patrz komentarz
w `apps/dcs/lib/module-permissions.ts`). Admin nie jest tym dotknięty:
`profiles.role` rozstrzyga sprawę wcześniej i zapytanie nie jest wykonywane.

## Workspace (pnpm) i zakres buildów Vercela

- Członkami workspace (`pnpm-workspace.yaml`) są `apps/*`, `packages/*`
  oraz — celowo — trzy katalogi bez kodu: `docs`, `supabase`, `scripts`,
  każdy z własnym `package.json` (`@scl/docs`, `@scl/supabase`,
  `@scl/scripts`; `private: true`, wersja `0.0.0`, bez skryptów, bez
  zależności). Powód: Vercel pomija build projektu nieobjętego zmianą tylko
  wtedy, gdy zmienione pliki należą do jakiegoś pakietu workspace; zmiana
  poza pakietami jest „globalna” i przebudowuje oba projekty. Dzięki
  członkostwu PR z samą migracją, testem pgTAP, dokumentacją lub skryptem
  CI nie buduje aplikacji. Nic nie może zależeć od tych trzech pakietów
  i nie wolno dodawać im skryptu `build` — turbo ma je widzieć jako
  no-op (`<NONEXISTENT>` w `turbo run build --dry`).
- Ograniczenie, którego to nie usuwa: `packages/db/src/database.ts` jest
  jednym plikiem dla obu produktów, a `@scl/db` jest zależnością obu
  aplikacji, więc każda migracja z regeneracją typów przebudowuje
  Timesheet i DCS. Podział typów — `docs/deferred-tasks.md` (s).
- Nowy katalog top-level, który będzie dotykany w zwykłych PR-ach, dostaje
  taki sam pusty `package.json` i wpis w `pnpm-workspace.yaml`.

## PR-y

- Jeden temat na PR; migracja + RLS + test pgTAP + regeneracja typów razem.
- CI musi być zielone (guardy, pgTAP, type-drift, lint, typecheck, build
  w trybie strict env). Nowa zmienna budowa = wpis w `env` w `turbo.json`.
- **`ci` to jedyny automatyczny check, który cokolwiek sprawdza.** CodeRabbit
  jest podpięty, ale PR-ów w tym repo nie recenzuje — raportuje
  `Review skipped: manual review required for this OSS repository` i od razu
  zielone „pass" (odczyt z PR #66, 18.09). Nie czytaj tego jako przeglądu
  kodu: zielony CodeRabbit nie znaczy, że ktokolwiek — człowiek czy bot — ten
  diff przeczytał.
- Merge do `main` automatycznie pcha migracje na scl-dev — nie merguj
  migracji, której nie chcesz jeszcze na scl-dev. Prod wyłącznie przez
  ręczny `workflow_dispatch` (patrz 01-architecture). Do 2026-09-01 to
  zdanie było nieprawdziwe — patrz [ADR-0007](adr/0007-deploy-bazy-wylacznie-przez-ci.md)
  i reguła o integracji GitHub w sekcji „Środowiska i deploymenty".
- Opis PR: co i dlaczego, plus jak zweryfikowano (wynik `supabase test db`,
  zrzut ekranu dla UI).

## Środowiska i deploymenty

- Podglądowe i deweloperskie deploymenty NIGDY nie wskazują na produkcyjny
  projekt Supabase. Preview → scl-dev, Production → prod. Wykryte 2026-09-01:
  Preview Timesheetu celował w prod od ~67 dni.
- Konsekwencja praktyczna: zmienne środowiskowe Supabase
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) w Vercelu muszą mieć osobne wartości dla
  Preview (scl-dev) i Production (prod). Naprawa allowlisty redirectów tego nie
  rozwiązuje — nieprzejrzany kod z gałęzi mógłby mutować dane produkcyjne
  (sprzeczne z §12.2 briefu). Dlatego `[remotes.production].additional_redirect_urls`
  w `config.toml` celowo NIE zawiera wildcardu preview Vercela.
- **Integracja GitHub Supabase (branching) musi pozostać WYŁĄCZONA na obu
  projektach** (scl-dev i prod). Włączona w dashboardzie aplikuje migracje
  i `config.toml` na prod przy każdym merge'u do `main`, z pominięciem
  `deploy-db.yml` i bramki `production-db` — jej włączenie unieważnia cały
  proces wdrożeń opisany tu i w 01-architecture. Wykryte 2026-09-01
  (dotyczyło co najmniej PR #13 i #15) —
  [ADR-0007](adr/0007-deploy-bazy-wylacznie-przez-ci.md).
