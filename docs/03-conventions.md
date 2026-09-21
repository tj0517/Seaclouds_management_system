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
- **Widok nad tabelą `dcs.*`: `security_invoker = true` i wszystkie złączenia
  LEFT — także te pod kluczem obcym.** Pierwsze, bo widok bez tej opcji czyta
  się uprawnieniami WŁAŚCICIELA, więc oddaje każdemu zalogowanemu użytkownikowi
  wszystko, co widzi właściciel — widok ma nie poszerzać dostępu, tylko
  przepuszczać RLS tabeli źródłowej. Drugie jest mniej oczywiste i dlatego
  stoi tutaj: **klucz obcy gwarantuje, że wiersz ISTNIEJE, a nie że wołający
  MOŻE GO ZOBACZYĆ.** INNER JOIN do tabeli, której RLS ktoś później zawęzi,
  nie zwróci wtedy pustej etykiety — **usunie cały wiersz z widoku**, po cichu
  i bez błędu. Dla rejestru, którego jedynym zadaniem jest kompletność, to
  najgorszy możliwy tryb awarii: brakującego dokumentu nikt nie zauważy.
  LEFT JOIN degraduje się do pustej komórki, którą widać. Tabelą wiodącą ma
  być ta, której RLS jest bramką (w `dcs.v_mdr`: `dcs.documents`).
  Wzorzec: migracja `20260919123436_create_mdr_register_view` (1b.05).
- Dowód na RLS (test, ekran, demo) jest ważny wyłącznie, gdy zapytanie nie
  zawiera żadnego warunku w kodzie — czysty `select` z tabeli, bez `.eq()`,
  bez embedów `!inner`, bez filtrów. Różnicę zbiorów między użytkownikami
  musi robić sama baza. Ekran, który filtruje po stronie aplikacji, nie
  dowodzi niczego o politykach.

## `public.audit_log` nie jest w pełni zakresowalny po projekcie

**Reguła: każdy filtr, eksport, raport, reguła retencji albo sprzątanie, które
rozumuje „po projekcie" na `public.audit_log`, musi jawnie nazwać to
założenie — bo ono nie jest prawdziwe dla całej tabeli.**

Do dziennika pisze dziś **dziesięć** tabel przez `public.audit_trigger()`.
Funkcja ustala `project_id` w trzech krokach i to on decyduje o wszystkim
poniżej:

```sql
if v_table = 'public.projects' then
  v_project_id := v_record_id;          -- sam projekt: własne id
elsif v_row ? 'project_id' then
  v_project_id := (v_row ->> 'project_id')::uuid;
end if;                                  -- w pozostałych przypadkach: NULL
```

Czyli podział przebiega nie tam, gdzie się wydaje — **`public.projects` nie ma
kolumny `project_id`, a mimo to jest zakresowane**, bo funkcja obsługuje je
osobnym przypadkiem:

| `project_id` w dzienniku | tabele |
|---|---|
| zawsze ustawione | `dcs.documents`, `dcs.revisions`, `dcs.files`, `dcs.mdr_settings`, `dcs.project_roles` (mają kolumnę) + `public.projects` (przypadek szczególny) |
| **zawsze NULL** | `dcs.dictionaries`, `public.profiles`, `public.clients`, `public.module_permissions` |

Odczyt z lokalnego stacka po `db reset` (2026-09-19) potwierdza to wprost:
`dcs.dictionaries` 101 wierszy z NULL i 0 bez, `public.profiles` 8 / 0,
`public.module_permissions` 4 / 0, przy `public.projects` 0 / 2
i `dcs.mdr_settings` 0 / 1.

**Uwaga na `dcs.dictionaries`:** to nie jest przypadek brzegowy o kilku
wierszach. Słowniki są tabelą `dcs.*` i intuicja podpowiada, że ich ślad da się
odczytać „po projekcie" — nie da się, są globalne, i to one dają w dzienniku
najwięcej wierszy z NULL.

Dwie konsekwencje, obie praktyczne:

1. **`where project_id = …` nie zwraca całego śladu.** Zwraca ślad tabel
   projektowych. Wiersze o osobach i o słownikach — utworzenie i usunięcie
   profilu, nadanie i odebranie dostępu do modułu, każda zmiana słownika DCS —
   są poza nim i **żaden filtr po projekcie ich nie zobaczy**, bo nie należą
   do projektu.
2. **`record_id` bywa jedynym uchwytem, a czasem nie da się go zapisać z
   góry.** `public.module_permissions` powstaje z triggera
   `grant_default_module_access()` (1a.22) ze **świeżym UUID przy każdym
   wywołaniu**, więc odpowiadającego wiersza dziennika nie da się wskazać
   literałem — trzeba go odczytać, zanim źródłowy wiersz zniknie.

**Jak to wyszło — i to jest tu najważniejsze zdanie.** Nie z testu. Test
przechodził. Wyszło z **uzgodnienia liczby wierszy**: zapytanie zakresowane po
`project_id` raportowało **zero**, a `select count(*) from public.audit_log`
rosło o **osiem przy każdym przebiegu** (116 → 124 → 132, pomiar
2026-09-19, DCS 1b.06). Zapytanie zakresowane odpowiadało poprawnie na pytanie,
które zadano; pytanie było węższe niż tabela. Pełna historia i decyzje:
`docs/deferred-tasks.md` (ss).

**Wzorzec do naśladowania przy sprzątaniu albo migracji danych dziennika:**
policz wiersze w zakresie ORAZ całość przed i po, i porównaj różnice. Jeżeli
`total_before - total_after` nie równa się liczbie wierszy w zakresie, operacja
ruszyła coś poza nim — a `public.audit_log` to dowód wobec klienta, nie dane
testowe (patrz `CLAUDE.md`: na produkcji kasowanie jest zakazane bez wyjątków).

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
**Przyjęty baseline (scl-dev, odczyt 2026-09-19 14:48Z, stan po DCS 1b.05):
23 × 0027 + 12 × 0029**, nic innego — bez zmian względem odczytu
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

**DCS 1b.05 podniosła 0027 z 22 na 23 — ZMIERZONE** (scl-dev, odczyt
2026-09-19 14:48:45Z, po wdrożeniu migracji `20260919123436`). Wcześniejsza
wersja tego akapitu stała tu jako liczba *przewidziana*; jest zastąpiona
odczytem. 23. wpis to `dcs.v_mdr` i advisor opisuje go wprost jako **widok**
(`"view \`dcs.v_mdr\` is visible in the GraphQL schema…"`, `"type":"view"`) —
lint 0027 liczy także widoki, jego opis wymienia je z nazwy („tables, views,
materialized views, and foreign tables"). Powód jest ten sam co przy każdej
pozycji na tej liście i tak samo zamierzony: bez `SELECT` dla `authenticated`
rejestr nie zwróciłby nikomu ani wiersza, a widoczność wierszy ogranicza RLS
(`security_invoker = true`), nie granty. Granty na widoku są zawężone do
samego `SELECT` — odczyt ACL na scl-dev: `authenticated=SELECT`,
`service_role=SELECT`, `anon` nic. **0029 stoi na 12**, zgodnie z
przewidywaniem: widok nie jest funkcją.

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
baseline (scl-dev, odczyt 2026-09-19 14:48Z, stan po 1b.05):**

| Lint | Poziom | Liczba |
|---|---|---|
| `multiple_permissive_policies` | WARN | 223 |
| `auth_rls_initplan` | WARN | 29 |
| `unused_index` | INFO | 23 (22 przed 1b.05, 25 przed 09-19) |
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
- **`unused_index`** — **18 z 23 wpisów to indeksy trzech tabel rejestru**
  (`dcs.documents` 9, `dcs.revisions` 6, `dcs.files` 3); pozostałe 5 są zastane
  (`dcs.dictionaries` 1, `public.projects` 1, `public.expense_entries` 2,
  `public.user_monthly_earnings` 1). Advisor mówi tu wyłącznie „scl-dev jeszcze
  z tego indeksu nie skorzystał", co dla tabeli z jednym wierszem jest niemal
  tautologią — nie usuwaj ich, dopóki rejestr nie ma danych i realnego ruchu.

  Dwa ruchy tej liczby w ciągu jednego dnia, oba **zmierzone**, oba zamierzone:

  1. **25 → 22 między 2026-09-18 a 2026-09-19, bez żadnej migracji.** Trzy
     indeksy na `dcs.documents` (z 11 zostało 8) zaczęły być używane, gdy
     ekrany 1b.04 zaczęły tę tabelę czytać. Spadek jest po dobrej stronie
     i nikt go nie „naprawiał" — odnotowany, żeby następny odczyt nie czytał
     różnicy wobec 25 jako regresji.
  2. **22 → 23 po 1b.05** (odczyt 2026-09-19 14:48Z): doszedł
     `documents_search_idx`, indeks trigramowy pod wyszukiwarkę rejestru, więc
     `dcs.documents` wróciło z 8 na 9. Potwierdzone odczytem, że to właśnie ten
     indeks jest na liście. Planista go przy jednym wierszu nie wybierze i to
     jest **oczekiwane** — pomiar progu (~20 000 wierszy) stoi w nagłówku
     migracji `20260919123436_create_mdr_register_view`.
- **`unindexed_foreign_keys`** wróciło do zastanych 10 po 1b.01a. Wszystkie
  dziesięć to TES/core plus `dcs.project_roles.assigned_by`; **żaden nie
  dotyczy tabel rejestru dokumentów**. Pilnuje tego asercja w
  `supabase/tests/rls_document_register.test.sql`, która porównuje pełną listę
  kolumn klucza obcego z wiodącymi kolumnami indeksu — 1b.01 miała tu asercję
  słabszą niż advisor (tylko pierwsza kolumna), przez co przepuściła
  jedenaście złożonych kluczy i lint skoczył chwilowo do 21.
- **`auth_rls_initplan`** stoi na 29 od 1a.22; 1b.01 i 1b.05 nie dołożyły nic
  (warunek `aal2` jest w 1b.01 zapisany jako `((select auth.jwt()) ->> 'aal')`,
  a widok `dcs.v_mdr` nie ma własnych polityk). **29 wpisów rozkłada się na 12
  tabel i to w OGROMNEJ większości dług TES/core, nie DCS** — odczyt scl-dev
  2026-09-19 12:51Z:

  | Tabela | Wpisów |
  |---|---|
  | `public.timesheet_entries` | 7 |
  | `public.expense_entries` | 4 |
  | `public.expense_tables` | 4 |
  | `public.profiles` | 3 |
  | `public.timesheet_submissions` | 3 |
  | `dcs.dictionaries` | 2 |
  | `public.pdf_exports`, `public.project_assignments`, `public.projects`, `public.sub_project_assignments`, `public.sub_projects`, `public.weekly_contract_codes` | po 1 |

  Czyli **27 z 29 to `public` (TES/core), a tylko 2 to `dcs`** — polityki DC na
  `dcs.dictionaries` z 1a.11, zapisane jako `(select auth.jwt() ->> 'aal')`,
  którą to formę advisor mimo podzapytania nadal zgłasza
  (`docs/deferred-tasks.md` (oo)). Ta rozpiska stoi tu, bo wcześniejsza wersja
  tego punktu wymieniała wyłącznie `dcs.dictionaries` i dało się ją przeczytać
  jako „to lint o słownikach DCS". Nie jest — jest o RLS Timesheeta.

Uzasadnienie 0027/0029 zweryfikowano odczytem na prod (2026-08-31):
`pg_policy` (wyrażenia polityk wołające te funkcje) oraz
`has_function_privilege('authenticated', …)`. „Pusta lista advisora” nie jest
osiągalnym celem dla tego projektu.

## Dowód wizualny: narzędzie może pokazywać mniej niż prawdę

Zapisane przy DCS 1b.05 follow-up (2026-09-19). Ta sama rodzina co reguła
o `public.audit_log` wyżej: nie chodzi o błąd w repo, tylko o pomiar, który
wygląda na wynik, a nim nie jest.

- **Renderer headless nie rezerwuje miejsca na scrollbar** — również dla
  kontrolki syntetycznej. `::-webkit-scrollbar { height: 12px }` na
  przewijanym elemencie daje w headless Chromium `offsetHeight - clientHeight
  = 0`, a w headful 12px. Pomiar w headless „potwierdził" więc, że poprawka
  nie działa, choć działała.
- **Chromium ignoruje `::-webkit-scrollbar`, gdy ustawione jest
  `scrollbar-width` albo `scrollbar-color`.** Arkusz wygląda na ostylowany,
  a pod spodem zostaje oryginalne zachowanie platformy. (Stąd `@supports not
  selector(::-webkit-scrollbar)` wokół właściwości standardowych — to nie
  porządki, tylko warunek działania reguł niżej.) Dodatkowo
  `scrollbar-gutter` z definicji nie działa na scrollbarze nakładkowym, więc
  samo `stable` niczego nie naprawia.

Obie rzeczy wyszły z **kontrolki trzyprzypadkowej** (bez stylowania /
`::-webkit-scrollbar` / plus `scrollbar-gutter`), a nie z testu — test przy
obu usterkach przechodził. Reguła praktyczna: zanim uznasz pomiar w przeglądarce
za dowód, zmierz obok przypadek, który **musi** dać inny wynik. Jeżeli nie daje
— mierzysz renderer, nie swoją zmianę.

## Fixtury lokalne i testy przeglądarkowe

Zapisane przy DCS 1b.07 (2026-09-20).

- **`supabase/fixtures/`** to dane, które istnieją wyłącznie na lokalnym stacku,
  do dowodu w przeglądarce — rzeczy, których nie ma na scl-dev, bo nic jeszcze
  ich nie tworzy (dziś: plik; od 1b.08 rewizję tworzy okno New Revision, ale fixtura
  nadal ładuje jedną, żeby panel miał co pokazać bez klikania). Nie jest to
  migracja (leży poza `supabase/migrations/`, więc `db push` go nie wyśle), nie
  jest częścią `seed.sql` (`db reset` zostaje bez zmian) i nie jest testem
  pgTAP. Ładuje się ręcznie po `supabase db reset`:
  `docker exec -i -e PGOPTIONS='-c app.local_fixture=yes'
  supabase_db_Seaclouds_management_system psql -U postgres -v ON_ERROR_STOP=1
  < supabase/fixtures/<plik>.sql`.
- **Od 1b.09 fixtura niesie `storage_path` na swoim wierszu `dcs.files`** (kolumna jest NOT NULL
  od PR #80), ale **bez obiektu w buckecie** — to celowy przypadek „wiersz jest, bajtów nie ma":
  Download na nim daje to samo zdanie co odmowa. Fixtura sprzed #80 (NULL) nie ładuje się już.
  **Konsekwencja, której CI nie widzi:** fixtur nie ładuje ani `supabase test db`, ani `ci.yml`,
  więc migracja, która zaostrza schemat (jak NOT NULL w #80), może zmergować się na zielono z
  fixturą, która od tej chwili nie ładuje się wcale — wyszło dopiero przy pierwszym skrypcie
  przeglądarkowym 1b.09 PR 2. Po każdej migracji ruszającej tabelę, którą fixtura wypełnia,
  załaduj ją lokalnie i sprawdź (`docs/deferred-tasks.md`, ccc).
- **Bezpiecznik:** plik odmawia uruchomienia bez `app.local_fixture=yes`.
  Konsola SQL w dashboardzie ani MCP `execute_sql` go nie ustawią. To pas
  bezpieczeństwa, nie granica — ktoś, kto ustawi zmienną, może go uruchomić
  gdziekolwiek.
- **`supabase test db` i CI go nie ładują — sprawdzone, nie założone.**
  `[db.seed] sql_paths` w `supabase/config.toml` to wyłącznie `./seed.sql`;
  `ci.yml` robi `supabase db reset` i `supabase test db`; `grep -rn fixtures
  .github/workflows supabase/config.toml package.json` niczego nie znajduje;
  a pełny przebieg `supabase test db` przy fixturze leżącej na dysku uruchomił
  26 plików, wszystkie z `supabase/tests/`. Fixturę ładuj **po** `supabase test
  db`, na czystym `db reset`: testy robią gołe `count(*)` po `dcs.documents`,
  a fixtura dodaje wiersze (nie sprawdzałem, które asercje by się wywróciły).
- **Testy przeglądarkowe: Playwright, uruchamiany lokalnie, nie w CI.** Skrypt
  `apps/dcs/e2e/document-profile.mjs`, `devDependency` `playwright` w
  `@scl/dcs`. **To świadoma decyzja z 1b.07, obok notatki 1a.12** (brak
  jsdom/RTL, `apps/dcs/vitest.config.ts`): drugie narzędzie, nie odstępstwo od
  pierwszego. Logika czysta — vitest. To, co robi STRONA (RLS decydujące, co
  widzą trzy sesje; akcja serwerowa zapisująca; wpis audytu w History) — tylko
  przeglądarka. Koszt zapisany wprost: zależność dev zmienia `pnpm-lock.yaml`,
  wspólny z Timesheetem.
- **Jak uruchomić** (wszystko lokalnie): `supabase start` i `supabase db reset`;
  fixtura jak wyżej; **build produkcyjny na Node 20** (`.nvmrc`; dowód na
  `next dev` się nie liczy — reguła niżej): `pnpm --filter @scl/dcs exec next
  build`, potem `pnpm --filter @scl/dcs exec next start --port 3001`
  (`.env.local` na lokalny stack); przeglądarka: `pnpm --filter @scl/dcs exec playwright install
  chromium` (sam `pnpm add` przeglądarek nie pobiera; na Linuksie bez
  bibliotek systemowych — u nas brakowało `libnspr4`, `libnss3`, `libasound2` —
  potrzebne `--with-deps` z sudo albo rozpakowane lokalnie paczki `.deb` i
  `LD_LIBRARY_PATH`); potem `pnpm --filter @scl/dcs e2e:profile`. Skrypt
  zapisuje do lokalnej bazy, więc odmawia uruchomienia przeciw czemukolwiek
  poza `localhost`; kończy się kodem 1, gdy którakolwiek asercja padnie, i
  zapisuje zrzuty ekranu do `E2E_SHOTS` (domyślnie katalog tymczasowy).
- **Drugi skrypt, `e2e:revision` (DCS 1b.08):** `apps/dcs/e2e/new-revision.mjs`,
  te same wymagania i ta sama fixtura; tworzy własne dokumenty (stałe id) i sprząta
  je na początku i na końcu, więc nie zużywa fixtury. Pokrywa okno New Revision i
  zakładkę Revisions (A, potem B, krok IFR → `00`, nadpisanie kodu przez DC,
  odmowy: Void, kod podany przez ORIG wprost do PostgREST). `e2e:profile` i
  `e2e:revision` przechodzą na buildzie produkcyjnym (DCS 1b.07b naprawiło
  zawieszony zapis numeru CPY, który przez to nie dawał się sprawdzić inaczej niż na
  `next dev`; przyczyna i pomiary: `docs/deferred-tasks.md` zz). **`e2e:profile`
  czyta 200 najnowszych wierszy audytu dokumentu z fixtury** (`HISTORY_LIMIT`) i
  sprawdza, że widać wśród nich wiersze „System (no session)” z jego założenia —
  skrypt, który dopisuje setki wierszy audytu do `DOC_A`, wypycha je poza limit i
  psuje tę jedną asercję (zdarzyło się przy pisaniu `e2e:pending`, patrz niżej).
  `e2e:profile` **przypina też HTTP 404** na czterech trasach `notFound()` (nieznany
  uuid i `abc` pod `/documents/`, `/projects/<nieznany>/documents`, oraz
  `/admin/projects/<nieznany>` dla admina z aal2): z przywróconym
  `app/(app)/loading.tsx` wszystkie cztery odpowiadają 200.
- **Trzeci skrypt, `e2e:pending` (DCS 1b.07b):** `apps/dcs/e2e/pending-action.mjs`
  + wspólne helpery `apps/dcs/e2e/support.mjs` (wyjęte, bo to trzeci skrypt — wpis
  (yy); dwa starsze skrypty nadal mają własne kopie). Dowodzi, że zapis przez
  `hooks/use-pending-action.ts` **dochodzi do skutku** na każdym ekranie, który go
  używa. Zapis liczy się, gdy (a) odświeżone drzewo jest w DOM — coś, co renderuje
  serwer (wiersz, nazwa, opcja, zremontowany `<input>`) — **i** (b) znikł
  wskaźnik pending; sam znikający spinner nie wystarcza. Powtarza każdy ekran
  (`E2E_REPEAT`, domyślnie 5; `E2E_PROBE_N`, domyślnie 30, dla pola CPY i `/mdr`),
  drukuje surowe liczby (`not-committed`, `stuck-pending`, `not-stored`,
  `step-errors`) i kończy się kodem 1 przy jakimkolwiek zawieszeniu. Wymaga
  `e2e.admin@local.test` — admina z zweryfikowanym faktorem TOTP, którego
  `/admin` wymaga (aal2), założonego przez fixturę **a nie przez `seed.sql`**:
  dwa pliki pgTAP (`dcs_profile_directory`, `rls_module_permissions`) przypinają
  skład seeda, więc dodanie do niego użytkownika łamie trzy asercje. CPY bije w
  **własnym dokumencie** (`DOC_PENDING`), nie w `DOC_A` — patrz uwaga o
  `HISTORY_LIMIT` wyżej. Pokrycie dwunastu miejsc wywołania hooka:

  | Komponent | Ekran | Dowód |
  |---|---|---|
  | `CpyNumberField` | `/documents/[id]` | `e2e:pending` (`cpy`), `e2e:profile` |
  | `AddMemberForm`, `RoleCheckboxGroup`, `EditProjectDialog` | `/admin/projects/[id]` | `e2e:pending` |
  | `ClientDialog` (dodaj, edytuj), `ClientsTable` | `/admin/clients` | `e2e:pending` |
  | `DictionaryEntryDialog`, `DictionaryTypeTable` | `/admin/dictionaries` | `e2e:pending` |
  | `MdrToolbar` (zapisz, zmień nazwę, domyślny, usuń; eksport tylko `run`) | `/mdr` | `e2e:pending` |
  | `CreateProjectWizard`, `DocumentCreateForm` | `/admin/projects/new`, `/documents/new` | `e2e:pending` |
  | `NewRevisionDialog` | `/documents/[id]` | `e2e:revision` |
  | `AddFileDialog` (panel i rozwinięty wiersz zakładki Revisions) | `/documents/[id]` | `e2e:pending` (`addfile`, `E2E_PROBE_N`), `e2e:files` |
- **Czwarty skrypt, `e2e:files` (DCS 1b.09 PR 2):** `apps/dcs/e2e/revision-files.mjs`, te same
  wymagania, ta sama fixtura (od 1b.09 zakłada też `tes.profile@local.test` — członek TES bez
  roli DCS — i `view.profile@local.test`, rola `view`). Tworzy własny dokument z dwiema rewizjami
  i sprząta go razem z wierszami `storage.objects` swojego folderu (lokalnie odstawia na jedną
  instrukcję `storage.protect_delete` przez `storage.allow_delete_query`). Pokrywa: wgranie przez
  wiersz zakładki i przez panel, nazwę generowaną (data rewizji albo data wgrania UTC, NN 01→02→03,
  rozszerzenie małymi literami, brak rozszerzenia), `original_name` jako podpowiedź, pobranie
  jako realny download przeglądarki pod nazwą generowaną, wygaśnięcie URL-a po 60 s (czeka
  61 s; `E2E_SKIP_EXPIRY=1` pomija), brak publicznego URL-a, i odmowy dowiedzione **dwa razy** —
  przez ekran i przez bezpośrednie wywołanie storage-api / PostgREST jako ten użytkownik:
  `view` pobiera, nie wgrywa; członek TES bez roli widzi wiersze `dcs.files`, nie dostaje bajtów
  (O-16); outsider 404 i 0 wierszy; DC na aal1 odmowa, na aal2 wgrywa; kolizja NN = 409
  `Duplicate` przy podpisywaniu, a obiekt-sierota w folderze (bez wiersza) nie blokuje numeru,
  bo NN czyta się z wierszy **i** z listingu folderu. Sekcja (h) (PR #81, rundy 3 i 4) to UX
  wgrywania na rewizji A: podwójny klik w „Upload" i dwa `form.requestSubmit()` w jednym tasku dają
  **dokładnie jeden** obiekt i jeden wiersz (liczone `count(*)` w `dcs.files` i `storage.objects`);
  plik 50 MiB (zapisywany do katalogu tymczasowego OS, upload dławiony przez CDP do 16 MiB/s, żeby
  pasek miał wartości pośrednie) — `MutationObserver` w stronie (`armSampler`) loguje każdą mutację
  DOM razem ze stanem paska, przycisku i listy: pasek startuje od 0, ma wartości między, dochodzi
  do 100, a przy każdej z nich (dopóki dialog ma `data-state="open"`) przycisk jest `disabled` i
  pokazuje „Adding…"; PUT przerwany przez `page.route` → zdanie o sieci zamiast paska, przycisk
  wraca do „Upload", nic nie zapisane, ten sam plik z tego samego dialogu ląduje przy ponownym
  kliknięciu; **reguła nieaktualnej listy** (h/5): w każdej próbce od kliknięcia do pojawienia się
  nowego wiersza jest wskaźnik albo wiersz, dialog jest otwarty w każdej z nich, a zamyka się dopiero
  po wierszu (czerwony dowód: dialog zamykany przed odświeżeniem, jak do rundy 3, łamie tę asercję);
  server action, którego POST przerywa `page.route` (h/6) → zdanie „The request to the server
  failed…", przycisk wraca do „Upload", nic nie zapisane, ponowne kliknięcie ląduje. Sekcja (i)
  (runda 4, po nieudanym wgraniu JPG na Preview, którego przyczyny nie udało się ustalić — żadne
  żądanie tej próby nie dotarło ani do Vercela, ani do Supabase): pięć realnych plików graficznych
  (`photo.jpg`, `IMG_4123.JPG` 4032×3024, `IMG_4124.jpeg`, `Zdjęcie z budowy 12.09 (v2).jpg`,
  `screenshot.png`; generowane przez `sips`, albo z `E2E_IMAGES_DIR`) — każdy ląduje z nazwą
  generowaną, `original_name`, rozmiarem, `image/jpeg`/`image/png` i obiektem. Przypadek
  `DownloadFileButton` nie używa hooka (`useTransition`), więc nie ma go w tabeli wyżej; jego dowód
  to `e2e:files`.
- **`e2e:profile` bywa czerwone na ostatniej asercji („no console or hydration errors") z powodu
  niezależnego od zmiany pod testem: przerywanego hydrowania panelu (React #418), zmierzonego i
  nierozstrzygniętego w `docs/deferred-tasks.md` (ccc) — ok. 3 na 100 ładowań w sekwencji RED 3,
  ok. 1 na 80 na `origin/main`. Skrypt drukuje przy błędzie URL i ostatnią zaliczoną asercję;
  podawaj surowe liczby serii, nie „flaky".
- **Pobranie to `redirect()` z server action do podpisanego URL-a z `Content-Disposition:
  attachment` — zmierzone na buildzie produkcyjnym, że przeglądarka pobiera plik, a strona
  zostaje żywa** (zakładki przełączają się, przycisk wraca do stanu enabled; `e2e:files` a/5).
  Obawa, że router Next zawiesi drzewo po nawigacji zewnętrznej, która nie wyładowuje strony,
  nie potwierdziła się w tej wersji (Next 16.1.1) — asercja stoi w skrypcie, żeby regresja
  wyszła w pomiarze, nie w produkcji.
- **Dowód przeglądarkowy: build produkcyjny (`next build` + `next start`), nigdy
  `next dev` (DCS 1b.07b, 2026-09-21).** Dwa razy błąd po stronie klienta przeszedł
  na `next dev` i wyszedł dopiero na buildzie produkcyjnym: Timesheet `/mfa`
  (1a.25b → 1a.25c; stawki nie mierzono) i zapis numeru CPY w DCS (1b.07 → 1b.07b:
  `e2e:profile` 36/36 na `next dev`; na buildzie produkcyjnym 3 z 10 przebiegów
  czerwone, sonda zapisu 16 z 40 zawieszeń, w `e2e:pending` po resecie bazy 5 z
  30). Dowód, który nie poszedł na buildzie produkcyjnym, jest zgłaszany jako
  `next dev` i nie liczy się jako dowód przejść po stronie klienta. Błąd bywa
  losowy (17–83% zapisów, ta sama baza kodu, różne sesje — powodu rozrzutu nie
  znamy), więc **jeden zielony przebieg niczego nie dowodzi**: licz próby (N ≥ 30),
  podawaj surowe liczby, nie stosunek, i sprawdzaj, że odświeżone drzewo trafiło
  do DOM, a nie tylko że zniknął spinner.
- **`loading.tsx` nad stroną, której akcje serwerowe wołają `revalidatePath`,
  wymaga pomiaru zawieszeń na buildzie produkcyjnym (N ≥ 30) przed merge'em.**
  Next 16.1.1 potrafi wtedy nigdy nie zatwierdzić odświeżonego drzewa
  (transition lane zawieszony i nie „pingnięty”, mimo kompletnej odpowiedzi):
  [vercel/next.js#98303](https://github.com/vercel/next.js/issues/98303), także
  [#86055](https://github.com/vercel/next.js/issues/86055). Zmierzone
  w 1b.07b, że to nie jest reguła „każdy `loading.tsx` + każdy `revalidatePath`”:
  `/mdr` woła `revalidatePath` w pięciu akcjach, leży pod tą samą granicą i nie
  wisi (0/30 na akcję). Mechanizmu, który to rozstrzyga, nie znamy — stąd pomiar,
  nie wnioskowanie. Usunięte szkielety i ich liczby: `docs/deferred-tasks.md` zz.
- **Dowody, których nie da się zrobić w pgTAP: `scripts/revision-proofs.py`
  (DCS 1b.08).** Wyścigi (dwa zamki, równoległe sesje psql) i „zepsuj każdą
  kontrolę po kolei i pokaż, że jej test czerwienieje”. Też lokalnie, też poza CI;
  `concurrency` COMMITUJE wiersze, więc po nim `supabase db reset`.
- **Dlaczego nie w CI:** CI stawia stack tylko z bazą (`supabase start -x
  gotrue,…,kong,postgrest,…`) — nie ma Auth ani API, więc nie ma sesji do
  zalogowania. e2e w CI wymagałoby pełnego stacku i uruchomionej aplikacji i
  jest poza zakresem 1b.07.
- **Timesheet: strona `/mfa` (1a.25c, 2026-09-20) — ta sama decyzja, drugi
  skrypt.** `apps/timesheet/e2e/mfa-navigation.mjs`, `devDependency`
  `playwright` w `@scl/timesheet` (koszt z 1b.07 zapłacony drugi raz:
  `pnpm-lock.yaml` zyskał jeden wpis importera, 3 linie). Pilnuje błędu, który
  wyszedł dwa razy (DCS 1a.25, Timesheet 1a.25b): po poprawnym kodzie strona
  wisi na „Verifying…". Trzy przypadki — factor zweryfikowany, brak factora
  (enrolment), factor niezweryfikowany (pending) — i w każdym asercja na
  **kształt** nawigacji: pierwsze żądanie do aplikacji po submicie ma być
  `DOCUMENT GET /admin`, nie `RSC`. Sam końcowy URL nie wystarcza: na `next dev`
  wersja ze zwykłym `router.push` też kończy na `/admin` (zmierzone), a wisi
  dopiero na buildzie produkcyjnym. Każdy console error i błąd hydracji wywala
  przebieg. To rzeczywista przeglądarka dla modelu z
  `lib/mfa-verify-navigation.test.ts`.
- **Jak uruchomić oba zestawy Timesheeta** (wszystko lokalnie):
  - vitest — `pnpm --filter @scl/timesheet test:unit` (33 testy).
    `safeNextPath` ma tu swój zestaw od 1a.26: `lib/mfa-navigation.test.ts`.
  - przeglądarka, **domyślnie na buildzie produkcyjnym** — `supabase start` i
    `supabase db reset` (fixtura DCS nie jest potrzebna: skrypt sam zakłada
    trzech adminów `e2e.mfa.*@local.test` i ustawia ich factory); w
    `apps/timesheet/.env.local` lokalny stack; `pnpm --filter @scl/timesheet
    exec next build`, potem `pnpm --filter @scl/timesheet exec next start -p
    3100`; przeglądarka i biblioteki jak w wpisie 1b.07 (`pnpm --filter
    @scl/timesheet exec playwright install chromium`); potem
    `E2E_BASE_URL=http://localhost:3100 pnpm --filter @scl/timesheet
    e2e:mfa`. Kod 1, gdy którakolwiek asercja padnie; zrzuty do `E2E_SHOTS`.
    **Dlaczego build, a nie `dev`:** na `next dev` zrewertowana strona i tak
    kończy na `/admin`, więc dev łapie regresję wyłącznie po kształcie żądania,
    a samo zawieszenie odtwarza tylko build. `dev` zatrzymaj przed buildem
    (nie sprawdzałem, czy dzielą `.next`).
  - **Wariant szybki: `next dev`** — `pnpm --filter @scl/timesheet dev` (port
    3000), potem `pnpm --filter @scl/timesheet e2e:mfa` bez `E2E_BASE_URL`.
    Wystarcza na co dzień do sprawdzenia kształtu nawigacji; nie odtwarza
    zawieszenia (patrz wyżej).
  - **Nie osłabiaj asercji do samego URL-a.** Sprawdzenie „kończy na `/admin`"
    przechodzi także ze zrewertowaną stroną na `dev` — test, który je zastępuje
    kształtu żądania (`DOCUMENT`, nie `RSC`), przestaje cokolwiek chronić.
- **Zabezpieczenia skryptu `/mfa`.** Zapisuje do bazy (zakłada użytkowników,
  podmienia factory i sesje **tylko tych trzech**; nie rusza
  `tjezionekspam@gmail.com` ani factora fixtury `dc.profile@local.test`), więc
  odmawia pracy przeciw hostowi innemu niż localhost — i **przerywa każde
  żądanie przeglądarki do hosta nie-lokalnego**, a takie żądanie kończy
  przebieg kodem 1. To drugie jest potrzebne, bo adres Supabase bierze
  aplikacja z `.env.local`, nie skrypt: dev server wskazujący na scl-dev albo
  prod zakładałby i weryfikował factory tam.
- **Kontrola czerwona** (bez niej zielony przebieg niczego nie dowodzi):
  przywróć lokalnie stronę sprzed poprawki — `git show
  683d17e^:apps/timesheet/app/mfa/page.tsx` (`router.push(safeNextPath(next));
  router.refresh()`) — i uruchom skrypt: pada w trzech przypadkach (pierwsze
  żądanie to `RSC`, nie `DOCUMENT`). Na buildzie produkcyjnym widać dodatkowo
  samo zawieszenie: przycisk „Verifying…" i jedyne żądanie
  `RSC GET /mfa?next=%2Fadmin`. Nie commituj tego.
- **Pułapka: zrzut ekranu potrafi wywołać „błąd hydracji".** Domyślne
  `page.screenshot()` wpisuje inline `caret-color: transparent` w każdy
  `<input>`; zrobiony w trakcie hydracji strony wygląda dla Reacta jak
  niezgodność atrybutów serwera i klienta. Skrypt robi zrzuty z `caret:
  'initial'`. Złapane przy pisaniu — fałszywy alarm skakał między przypadkami
  z przebiegu na przebieg.

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

## Stany ładowania w UI (decyzja z przeglądu PR #81, 2026-09-21)

- **Każda akcja użytkownika zmieniająca dane pokazuje stan „w toku” od kliknięcia
  do chwili, gdy wynik jest widoczny** — czyli odświeżone dane są w DOM (nowy
  wiersz, nowa wartość, zremontowany `<input>`), a nie tylko do chwili, gdy
  żądanie wróciło. Techniczny odpowiednik: `hooks/use-pending-action.ts` trzyma
  `pending` przez `router.refresh()` w tranzycji; dialog, który zamyka się
  wcześniej, łamie regułę, bo przez długość odświeżenia (400–470 ms na scl-dev)
  użytkownik widzi starą listę bez żadnego znaku.
- **Wyzwalacz akcji jest przez ten czas wyłączony**, więc podwójne wysłanie jest
  niemożliwe — atrybut `disabled` jest tym, co użytkownik widzi, a zatrzask
  `lib/single-flight.ts` tym, co trzyma (flipuje synchronicznie w handlerze
  kliknięcia, zanim DOM dostanie `disabled`).
- **Żaden ekran nie pokazuje po akcji nieaktualnych danych bez wskaźnika.** W
  każdej chwili między kliknięciem a odświeżonym DOM na ekranie jest wskaźnik
  (spinner, pasek, etykieta „Adding…/Saving…”) albo już nowe dane.
- **Nowe UI nie jest przyjmowane bez dowodu w przeglądarce na buildzie
  produkcyjnym** — skrypt `e2e:*` próbkuje DOM przy każdej mutacji od kliknięcia
  do nowego wiersza i wymaga w każdej próbce wskaźnika albo wiersza (wzór:
  `e2e:files` h/5, `armSampler` w `apps/dcs/e2e/revision-files.mjs`).
- Stan: **DCS 1b.09 (Add File) jest pierwszym przepływem zgodnym z regułą** —
  dialog zostaje otwarty z paskiem na 100% i przyciskiem „Adding…” aż do
  odświeżonej listy. **Znana luka: New Revision (`NewRevisionDialog`) — zadanie
  DCS 1b.08b**, nie ruszane w PR #81. Pozostałe ekrany z tabeli hooka niżej
  mają wskaźnik na przycisku, ale nie były sprawdzane pod kątem trzeciego punktu.

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
- **`workflow_dispatch` z gałęzi INNEJ niż `main` nie wdraża na proda —
  pomija zadanie i raportuje zielono.** `deploy-db.yml` ma na zadaniu
  produkcyjnym warunek `if: github.event_name == 'workflow_dispatch' &&
  github.ref == 'refs/heads/main'`, a samo `workflow_dispatch:` **nie deklaruje
  żadnych `inputs`** — nie ma parametru gałęzi. Selektor ref w UI GitHuba i tak
  pozwoli wybrać dowolną gałąź; wtedy `github.ref` nie jest `refs/heads/main`,
  warunek jest fałszywy i `push-prod` zostaje **pominięty**.

  **Groźna jest nie odmowa, tylko jej brak:** run kończy się **zielony**
  z pominiętym zadaniem — bez bramki zatwierdzenia, bez `supabase link`, bez
  `db push`, nic nie dociera na proda — a wygląda dokładnie jak udany deploy.
  Zielony run deploy-db **nie jest dowodem, że migracja jest na produkcji**;
  dowodem jest odczyt bazy (`supabase_migrations.schema_migrations`, obecność
  obiektu). Warunek jest celowy i zostaje: kupuje własność „produkcja nigdy nie
  dostaje migracji, której nie ma na trunku". Wykryte 2026-09-19 przy DCS 1b.05,
  zanim ktokolwiek dispatchował z gałęzi.

- **Konsekwencja dla zadania, które wiezie schemat i front razem:** te dwie
  reguły — „prod tylko z `main`" i „merge do `main` wdraża też aplikację na
  produkcję" — **nie dają się spełnić jednym PR-em**. Migracja może trafić na
  proda dopiero, gdy jest na `main`, ale ten sam merge wypuszcza na produkcję
  ekran, który jej potrzebuje. Okno między jednym a drugim to 500 na produkcji
  (PostgREST `42P01`). DCS 1b.05 rozbiło się z tego powodu na dwa PR-y — #70
  (sama migracja + test + regeneracja typów, nic w kodzie aplikacji sięgającego
  do nowego obiektu), potem dispatch na proda, potem #69 z ekranem. Reguła
  „jedno zadanie = jeden PR" ustępuje tu świadomie i **z nazwanego powodu**;
  bramka na linii `github.ref` zostaje bez zmian, bo własność, którą kupuje,
  jest warta więcej.

- **19.09.2026: podział 1b.05 na dwa PR-y NIE ZADZIAŁAŁ. Okno 11m16s na
  produkcji.** Zapisane z godzinami, bo godziny są tu całą treścią:

  | Czas (UTC) | Co się stało |
  |---|---|
  | 14:33:50 | **merge #69** — ekran **razem z migracją** (PR nie był przebazowany) |
  | 14:33:53 | `push-dev` → scl-dev, sukces |
  | ~14:34 | Vercel wdraża `dcs` na **produkcję**: `/mdr` żyje, a prod nie ma `dcs.v_mdr` → **okno otwarte** |
  | 14:42:27 | **merge #70** — `git diff 51e8026 eb8dc47` **pusty**, nie wniósł nic |
  | 14:42:38 | dispatch `production-db` z `main` startuje |
  | 14:45:06 | `push-prod` sukces → **okno zamknięte** |

  Przez **11 minut 16 sekund** `/mdr` na `dcs.seaclouds.eu` zwracało 500
  (PostgREST `42P01`), a wpis w sidebarze renderował się przy tym na **każdej**
  stronie DCS, bo jest bezwarunkowy. Czy ktoś wszedł — nie wiadomo, nie ma jak
  tego odczytać.

  **Podział na dwa PR-y powstał dokładnie po to, żeby temu zapobiec, i nie
  zapobiegł.** Powód nie jest techniczny: **kolejność merge'ów nigdy nie
  została zapisana jako instrukcja dla człowieka, który merguje** — żyła
  wyłącznie w numeracji kroków planu. Numer kroku nie jest instrukcją. PR
  z migracją stał otwarty i gotowy, PR z ekranem też, nic w GitHubie nie mówiło
  „nie ten pierwszy", i poszedł ten drugi.

  **Reguła, która z tego wychodzi — zdaniem, nie numerem kroku:** gdy zadanie
  wiezie schemat i front, **PR z samą migracją musi zostać zmergowany, a
  wdrożenie na proda potwierdzone ODCZYTEM bazy, ZANIM zmergowany zostanie PR
  z aplikacją.** Nie „najpierw krok 1, potem krok 4" — dokładnie to zdanie, w
  opisie obu PR-ów, w tej kolejności, z nazwą drugiego PR-a w treści pierwszego.

- **Integracja GitHub Supabase (branching) musi pozostać WYŁĄCZONA na obu
  projektach** (scl-dev i prod). Włączona w dashboardzie aplikuje migracje
  i `config.toml` na prod przy każdym merge'u do `main`, z pominięciem
  `deploy-db.yml` i bramki `production-db` — jej włączenie unieważnia cały
  proces wdrożeń opisany tu i w 01-architecture. Wykryte 2026-09-01
  (dotyczyło co najmniej PR #13 i #15) —
  [ADR-0007](adr/0007-deploy-bazy-wylacznie-przez-ci.md).
