---
id: DCS-1b.18
title: "Macierz osób i ról na stronie projektu (przydzielanie ról jednym kliknięciem)"
status: review
kind: code             # code | client | ops | milestone
difficulty: M
model: sonnet
model_approved: null
effort: medium
branch: feat/dcs-1b18-role-matrix-one-click
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 100
---

# DCS-1b.18 — Macierz osób i ról na stronie projektu (przydzielanie ról jednym kliknięciem)

## Cel
DC i admin nadają role w projekcie z jednej tabeli: osoby w wierszach, role (ORIG / REV / CHK / APP / DC / VIEW) w kolumnach. Dziś role nadaje się pojedynczo na stronie Team, co na prezentacji okazało się niewygodne. Sukces: DC widzi cały skład projektu na jednym ekranie i zmienia rolę jednym kliknięciem.

## Zakres
- [ ] Odczyt stanu bieżącego: `app/(app)/admin/projects/[projectId]/page.tsx` (sekcja Team), akcje zapisu `dcs.project_roles`, polityki RLS na `dcs.project_roles`
- [ ] Tabela osoby × role na stronie projektu; kandydaci = osoby przypisane do projektu (źródło wg obecnej sekcji Team)
- [ ] Zaznaczenie / odznaczenie komórki zapisuje / usuwa rolę istniejącą akcją (bez nowej ścieżki zapisu)
- [ ] Tylko do odczytu dla użytkownika bez prawa edycji (nie admin, nie DC tego projektu)
- [ ] Stan „w toku” na klikniętej komórce

## Gotowe, gdy
- zaznaczenie komórki zapisuje rolę, a po przeładowaniu stan tabeli się zgadza — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym (Preview → scl-dev), stan „w toku” do momentu, gdy odświeżone dane są w DOM (reguła z 1b.09, `docs/03-conventions.md`)
- użytkownik bez prawa edycji widzi tabelę bez możliwości zmiany — **jak sprawdzić**: dowód na koncie member na Preview
- każda zmiana roli jest w dzienniku zmian — **jak sprawdzić**: `select action, table_name, created_at from public.audit_log where table_name = 'project_roles' order by created_at desc limit 5` na scl-dev
- red proof: zapis roli przez DC innego projektu odrzucony przez bazę — **jak sprawdzić**: test pgTAP albo komunikat błędu RLS pokazany w raporcie

## Poza zakresem
- kreator nowego projektu (1a.17) — bez zmian
- edycja danych projektu przez DC → DCS-1b.19

## Bramki STOP
- jakakolwiek zmiana polityk RLS na `dcs.project_roles` — pokaż diff względem obecnej polityki i czekaj na akceptację

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`
- `apps/dcs/app/(app)/admin/projects/[projectId]/page.tsx`, `apps/dcs/lib/project-roles.ts`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23. Wybrany wariant: macierz osób i ról.
- 2026-09-25 tj: dowód przeglądarkowy na lokalnym buildzie produkcyjnym zamiast Preview → scl-dev — Preview jest pomijany przez Vercela, deploy scl-dev obecnie zepsuty.
- 2026-09-25 tj: macierz jako osobny komponent tylko dla strony projektu — `RoleCheckboxGroup` i `/admin/users/[userId]` zostają bez zmian (opcja B z dwóch przedstawionych; ryzyko zaakceptowane: dwa różne wzorce UX do nadawania roli w aplikacji).
