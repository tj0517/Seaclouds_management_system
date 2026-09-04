# ADR-0009 — `module_permissions`: dostęp do modułów per użytkownik, w `public`

## Kontekst

Client plan item 1a.03 wymaga, żeby nie każdy użytkownik TES trafiał do DCS —
dziś każde konto z ważną sesją przechodzi przez `proxy.ts` bez żadnej
warstwy "czy w ogóle wolno mu otworzyć ten moduł". Zadanie DCS 1a.22
wprowadza tę warstwę jako osobną tabelę, wspólną dla TES/DCS/BMS.

Trzy pytania do rozstrzygnięcia: gdzie żyje tabela (`public` czy `dcs`),
jaki ma kształt (wiersz per moduł czy kolumny `bool`), i czy `module` jest
enumem czy tekstem + CHECK (jak `dcs.dictionaries.dict_type`).

## Decyzja

- **Schemat `public`, nie `dcs`.** To odwrotność ADR-0008: tam rolą
  decydującą było "czyta wyłącznie DCS → `dcs`". Tu każdy moduł (TES, DCS,
  przyszłe BMS) czyta tę samą tabelę, żeby sprawdzić własny dostęp — jest to
  warstwa core na tym samym poziomie co `public.profiles`, nie
  DCS-specyficzna. Przeniesienie do `dcs` uniemożliwiłoby TES (który nie zna
  schematu `dcs`) sprawdzenie własnego dostępu bez przekraczania granicy
  modułów w drugą stronę.
- **Jedna tabela, wiersz = przyznanie** (`public.module_permissions`,
  `(user_id, module)` unikalny), nie trzy kolumny `bool` na `profiles` ani
  jeden wiersz per użytkownik z trzema flagami. Powody: (1) domyślny stan
  nowego użytkownika (TES tak, DCS/BMS nie) to "wstaw jeden wiersz", nie
  "wstaw wiersz z dwiema flagami false"; (2) dodanie czwartego modułu w
  przyszłości to nowa wartość enuma, nie ALTER TABLE na `profiles`;
  (3) `profiles` zostaje tabelą TES (ADR-0006/O-12) — moduły to osobne
  pojęcie, nie kolejna kolumna roli.
- **`module` to enum (`public.portal_module`), nie tekst + CHECK.** Odwrotnie
  niż `dcs.dictionaries.dict_type` (1a.07), gdzie lista rośnie w kolejnych
  fazach i ma być zwykłą migracją. Zestaw modułów portalu jest zamknięty i
  stabilny — brief wymienia TES/DCS/BMS i nic więcej, a dodanie modułu to
  decyzja produktowa (nowa aplikacja w monorepo, wpis w 1a.13/1a.23), nie
  rutynowa migracja. Enum dokumentuje tę domkniętość wprost.
- **Domyślne przyznanie TES żyje w triggerze na `public.profiles`**
  (`grant_default_module_access()`, `AFTER INSERT`), nie w `handle_new_user()`
  (funkcja bazowa, `auth.users`). Nowa, dodatkowa funkcja zamiast zmiany
  istniejącej — nie dotyka ścieżki, przez którą dziś przechodzi każde konto,
  i działa identycznie niezależnie od tego, czy profil powstaje przez
  self-signup (`handle_new_user()`) czy przez zaproszenie administratora
  (`upsert` w `apps/timesheet/app/data/actions/users.ts`).
- **Zapis do bazy audytu przez ten sam `audit_trigger()`** (1a.08) —
  `module_permissions` ma kolumnę `id uuid`, więc pasuje do istniejącego
  kształtu bez nowej gałęzi. `project_id` w logu wychodzi `NULL` (brak
  naturalnego zakresu projektowego), tak samo jak dla `profiles`/`clients`.

## Konsekwencje

- Warstwy `proxy.ts` (oba apps) i `apps/timesheet/app/admin/layout.tsx`
  **nie czytają jeszcze tej tabeli** — świadomie, poza zakresem 1a.22.
  Rozbieżność DC-bez-admina na Timesheet znaleziona w 1a.11 zostaje otwarta;
  ta tabela jest jej docelowym domem, ale podłączenie gate'ów to osobne
  zadanie.
- Ekran admina (`apps/timesheet/app/admin/users/[id]`) zyskuje kartę "Module
  Access" obok istniejącej karty dostępu do projektów — wzorzec
  checkbox + server action jest identyczny z `AssignmentCheckbox` /
  `toggleProjectAssignment` (`project_assignments`, TES).
- Lint advisora 0027 rośnie o jeden (nowa tabela czytana przez
  `authenticated` — własne wiersze) — baseline w `docs/03-conventions.md`
  zaktualizowany do 19.
- `dcs.dictionaries` i `module_permissions` są teraz dwoma tabelami
  "globalnymi/słownikowymi" bez `project_id` w rozumieniu reguły z
  `CLAUDE.md` — obie mają wpis uzasadniający w `docs/02-data-model.md`.

## Data / Status

2026-09-04 (DCS 1a.22) / przyjęta
