# ADR-0013 — Katalog imion jako funkcja SECURITY DEFINER, nie polityka na profiles

## Kontekst

1a.14 dało `dcs.project_roles` realną treść (grant/revoke ról), ale dwa
miejsca w aplikacji dalej jej nie widziały:

1. Lista projektów na `/dcs` czyta `public.projects` bez filtra — jedyna
   polityka SELECT (`"Widoczność projektów"`) przepuszcza każdego
   zalogowanego, więc grant/revoke roli nie zmienia niczego na ekranie
   (znane od przeglądu 1a.14, zapisane w `docs/deferred-tasks.md` (aa)).
2. Tabela zespołu na `/admin/projects/[projectId]` i selektor "add member"
   czytają `public.profiles` wprost — jedyna polityka SELECT
   (`"Bezpieczny dostęp do profili"`) to `auth.uid() = id OR is_admin()`, więc
   DC niebędący adminem widzi tylko swój własny wiersz: reszta zespołu
   pokazuje się jako skrócony `id`, a selektor jest pusty.

Punkt (1) rozstrzygnęło już 1a.14 (recenzja 2026-09-08): **nie** nowa
polityka na `public.projects` — ta polityka jest wspólną, produkcyjną
infrastrukturą Timesheetu (każdy ekran TES, który listuje lub wybiera
projekt, zakłada, że każdy zalogowany pracownik widzi każdy projekt,
niezależnie od `project_assignments`). Zawężenie tej jednej polityki
zepsułoby listy projektów w TES dla niemal każdego pracownika TES. Filtr
listy `/dcs` musi więc żyć wyłącznie po stronie `apps/dcs` — zadanie 1a.14b
to wykonuje (`apps/dcs/lib/project-list.ts`).

Punkt (2) jest nowy w tym zadaniu i wymaga osobnej decyzji: **jak** DC ma
zobaczyć imiona współpracowników, skoro polityka na `profiles` jest
świadomie wąska.

## Rozważane opcje dla (2)

**A. Nowa polityka SELECT na `public.profiles`**, np. "współczłonek
projektu DCS widzi profile innych członków tego projektu". Odrzucone: RLS
jest na poziomie wiersza, nie kolumny — `public.profiles` niesie
`rate_hourly`, `rate_daily`, `employee_id`, `position` (stawki i dane
kadrowe, brief: widoczne wyłącznie dla admina i samego siebie). Polityka
oparta na `dcs.project_roles` wpuściłaby współczłonka do **całego** wiersza,
czyli też do stawek — dokładnie tego, czego brief zabrania. Nie ma sposobu
w samym RLS, żeby "wpuść wiersz, ale ukryj dwie kolumny" — kolumny ukrywa
tylko `GRANT`/widok/funkcja.

**B. Widok (`view`) nad `profiles` z samymi `id, full_name`, z własną
polityką.** Odrzucone: widok pod RLS nadal dziedziczy semantykę wiersza
z tabeli źródłowej (widok bez `security_barrier` i własnej logiki i tak
odpytuje `profiles` pod politykami `profiles`, więc problem z (A) wraca;
budowa security-definera nad widokiem to więcej ruchomych części niż jedna
funkcja).

**C. Funkcja `SECURITY DEFINER` zwracająca dokładnie `(id uuid, full_name
text)`.** Wybrane. Ten sam wzorzec co `is_project_member`/`is_doc_controller`/
`is_any_doc_controller` (1a.09/1a.09b) — "public, obok is_admin(); jego ciało
nietknięte" to już ugruntowane miejsce na tego typu pomocnicze funkcje
międzyschematowe. Kolumny nigdy nie ma w wyniku, bo nigdy nie ma jej w
definicji `RETURNS TABLE(...)` — to gwarancja na poziomie schematu funkcji,
nie na poziomie polityki, którą trzeba by pamiętać utrzymać wąską przy
każdej przyszłej zmianie `profiles`.

## Decyzja

`public.dcs_profile_directory()` (migracja `20260909130753`): `SECURITY
DEFINER`, `search_path = ''`, `EXECUTE` dla `authenticated`, brak dla
`anon`/`PUBLIC` — dokładnie ten sam wzorzec grantów co pozostałe funkcje
pomocnicze RLS z 1a.09/1a.09b.

Zakres widoczności:
- **admin lub dowolny DC** (`is_admin()` / `is_any_doc_controller()`, obie
  bezprojektowe) — cały katalog. Notion mówi "DC może dodać członka" bez
  zawężenia do DC *tego* projektu — funkcja nie przyjmuje `project_id`,
  więc każdy DC (niekoniecznie tego projektu) widzi cały katalog. Read-only:
  to nie zmienia, kto może **pisać** do `dcs.project_roles` (to wciąż
  `is_doc_controller(project_id)` — DC innego projektu nadal nie zapisze
  ról na cudzym projekcie, RLS na `dcs.project_roles` niezmieniona).
- **zwykły członek** — współczłonkowie dowolnego projektu, na którym ma
  wiersz w `dcs.project_roles`, plus zawsze własny wiersz. Węziej niż
  `is_project_member()` (która liczy też samo `project_assignments` z TES):
  to katalog DCS, więc licząca się przynależność to rola DCS, nie logowanie
  godzin.

Filtr listy `/dcs` (punkt 1) zostaje wyłącznie aplikacyjny, zgodnie z
korektą 1a.14 — bez zmiany żadnej polityki na `public.projects`.

## Fail-closed na liście projektów, nie fail-open jak `fetchMyModuleAccess`

`resolveProjectListFilter` (`apps/dcs/lib/project-list.ts`) na błąd odczytu
`dcs.project_roles` zwraca `{kind: 'degraded'}`, co ekran renderuje jako
**pustą listę** z osobnym, czerwonym komunikatem — nie jako "pokaż
wszystko" i nie jako cichą pustą listę bez wyjaśnienia. To świadomie
odwrotność `fetchMyModuleAccess` (`apps/dcs/lib/module-permissions.ts`,
[ADR-0011](0011-module-access-fail-open-log-w-miejscu-odczytu.md)), która na
błąd odczytu **celowo** zakłada dostęp do TES (fail-open).

Powód rozbieżności — konsekwencje błędu są różne w obu miejscach:

- `fetchMyModuleAccess` odpowiada za to, czy w ogóle pokazać kafelek/link do
  TES w przełączniku modułów. Fail-closed tam oznaczałoby: sesja z
  prawdziwym dostępem do TES **i** DCS, ale akurat trafiająca na
  przejściowy błąd odczytu, zostaje uwięziona wewnątrz DCS bez linku
  powrotnego do jedynej aplikacji, która mogłaby jej ten dostęp z powrotem
  pokazać — realny lockout, bo DCS sam nie ma odpowiednika "zaloguj się
  gdzie indziej i przywróć dostęp". Fail-open kosztuje najwyżej martwy link
  (TES i tak sam sprawdzi dostęp niezależnie po kliknięciu).
- Lista projektów na `/dcs` nie broni wejścia do żadnej aplikacji — to
  wyłącznie widoczność wierszy `public.projects` na jednym ekranie. Tu
  fail-open (pokaż wszystkie projekty na błąd odczytu) nie ratowałby nikogo
  przed lockoutem — po prostu po cichu unieważniłby cały sens tego zadania
  (filtr per-rola) w dokładnie tym momencie, w którym coś już nie działa, i
  zrobiłby to bez żadnego komunikatu. Fail-closed + czerwony baner
  ("Couldn't load your project roles right now") kosztuje najwyżej chwilowo
  pustą listę z jasnym powodem i informacją, żeby spróbować ponownie —
  akceptowalne, bo nic nieodwracalnego się nie dzieje, a stan jest widoczny,
  nie ukryty.

Krótko: kierunek fail-open/fail-closed nie jest globalną konwencją tej
aplikacji — zależy każdorazowo od tego, co kosztuje więcej: fałszywe
"nie masz dostępu" (ADR-0011: może kosztować lockout) czy fałszywe "masz
dostęp do wszystkiego" (tutaj: kosztowałoby dokładnie to, co to zadanie ma
naprawić, po cichu). Obie decyzje logują błąd (`console.error`) — cichej
degradacji bez śladu nie ma w żadnym z dwóch miejsc.

## Konsekwencje

- `public.projects` i `public.profiles` — polityki bit-w-bit niezmienione;
  `supabase/tests/dcs_profile_directory.test.sql` asercjami na `qual` pilnuje
  tego jako regresji.
- Nowa funkcja dokłada dokładnie jeden wpis do advisora 0029
  (`authenticated_security_definer_function_executable`) — baseline scl-dev
  przechodzi z 19+11 na 19+12 (docs/03-conventions.md ma dziś nieaktualne
  19+10, patrz `docs/deferred-tasks.md` (aa); nie poprawiane tutaj, jedno
  zadanie = jeden PR).
- `rate_hourly`/`rate_daily`/`employee_id`/`position` pozostają dokładnie
  tak samo niewidoczne dla współczłonka jak przed tym zadaniem — funkcja
  nie poszerza niczego poza `id, full_name`.
- Selektor "add member" i tabela zespołu na `/admin/projects/[projectId]`
  przechodzą z odczytu `profiles` na `getProfileDirectory()`
  (`apps/dcs/lib/profile-directory.ts`) — zero zmiany w kształcie propsów
  komponentów (`AddMemberForm`/`RoleCheckboxGroup` nietknięte).

## Data / Status

2026-09-09 (DCS 1a.14b) / przyjęta
