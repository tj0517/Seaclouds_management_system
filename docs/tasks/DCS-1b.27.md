---
id: DCS-1b.27
title: "Pola do wpisania odróżnione od pól automatycznych (tło i ramka)"
status: todo
kind: code             # code | client | ops | milestone
difficulty: S
model: null
model_approved: null
effort: null
branch: null
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
---

# DCS-1b.27 — Pola do wpisania odróżnione od pól automatycznych

## Cel
Na prezentacji pola do wpisania wyglądały jak szare bloki, czyli jak coś wypełnianego automatycznie: mają przezroczyste tło na szarym tle strony. Użytkownik ma od razu widzieć, co wpisuje sam, a co ustala system.

## Zakres
- [ ] Odczyt stanu bieżącego: `apps/dcs/components/ui/input.tsx`, `textarea.tsx`, `SELECT_CLASS` (`AddMemberForm.tsx`), tło strony w `apps/dcs/app/globals.css`, miejsca z polami tylko do odczytu lub wyliczanymi (np. proponowany kod rewizji w New Revision)
- [ ] Pola edytowalne (input, textarea, select): białe tło i wyraźna ramka; fokus bez zmian
- [ ] Pola tylko do odczytu i wyliczane: tło szare, bez ramki pola
- [ ] Jedna definicja stylu w komponentach i tokenach, bez lokalnego nadpisywania tła w ekranach; tryb ciemny też

## Gotowe, gdy
- zrzuty przed i po: New Document, New Revision, Edit project, Dictionaries — **jak sprawdzić**: Playwright na buildzie produkcyjnym lokalnie, ścieżki w raporcie
- ramka pola edytowalnego ma kontrast co najmniej 3:1 do tła — **jak sprawdzić**: wartości kolorów z `globals.css` i wynik obliczenia w raporcie
- ekrany nie nadpisują tła pól lokalnie — **jak sprawdzić**: grep po klasach tła w miejscach użycia `Input`, `Textarea` i `SELECT_CLASS`, wynik w raporcie
- Timesheet nietknięty — **jak sprawdzić**: `git diff origin/main --stat` nie dotyka `apps/timesheet/` ani `packages/`

## Poza zakresem
- przebudowa formularzy i układu ekranów
- Timesheet
- kolory statusów MDR (O-05)

## Bramki STOP
- merge do `main` = produkcja DCS i Timesheet

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`
- `apps/dcs/app/globals.css`, `apps/dcs/components/ui/`

## Notatki z realizacji
- 2026-09-25 tj: ustalenie z klientem — pola input mają mieć kolor sugerujący wpisywanie; dziś szare bloki wyglądają jak pola automatyczne.
