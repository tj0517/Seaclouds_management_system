# ADR-0001 — Reużycie TES jako core zamiast `core.users`

## Kontekst

Brief SCL-DCS (§3.2, §3.4) zakłada warstwę wspólną w osobnym schemacie
`core` (users, roles, projects, clients, ctr_codes, audit_log). Równolegle
istnieje działający produkcyjnie SCL-TES z tabelami `public.profiles`
(+ `auth.users`), `public.projects` i `public.sub_projects`, z których
korzysta 15 użytkowników. Punkt otwarty O-02 briefu pytał, czy w Fazie 1a
przenosimy użytkowników TES do wspólnego core.

## Decyzja

Nie budujemy schematu `core` ani `core.users`. Rolę warstwy wspólnej pełnią
istniejące tabele TES w `public`: `auth.users` + `profiles` (konta i role),
`projects` (rejestr projektów), `sub_projects` (kody CTR). DCS odwołuje się
do nich przez klucze obce. Nowe obiekty wspólne (rejestr klientów, audit
log) powstają również w `public`.

## Konsekwencje

- Jedno konto i jedno logowanie do TES i DCS od pierwszego dnia; zero
  migracji użytkowników.
- Nazwy `core.*` z briefu czytamy jako `public.*` (mapowanie w
  [02-data-model.md](../02-data-model.md)).
- Rozszerzenia tabel wspólnych (np. pola MDR w `projects`) dotykają
  działającej produkcji TES — wymagają ostrożnych migracji (kolumny
  nullable / z defaultem) i przechodzą normalną drogę scl-dev → prod.
- Globalny enum `user_role` zostaje; role projektowe DCS wymagają osobnego
  rozstrzygnięcia (O-12).

## Data / Status

2026-08-27 (planowanie SCL Portal, baseline `pre-monorepo`) / przyjęta
