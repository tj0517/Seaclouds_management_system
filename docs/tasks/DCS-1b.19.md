---
id: DCS-1b.19
title: "DC edytuje ustawienia DCS projektu (cykle, budżet, numeracja CPY, status MDR)"
status: todo
kind: code             # code | client | ops | milestone
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: null
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
---

# DCS-1b.19 — DC edytuje ustawienia DCS projektu (cykle, budżet, numeracja CPY, status MDR)

## Cel
DC prowadzi projekt w DCS samodzielnie, bez proszenia admina: zmienia cykle przeglądu, budżet godzin, numerację CPY i status MDR. Dziś przycisk „Edit” widzi wyłącznie admin. Dane wspólne z Timesheetem (nazwa, klient, typ procesu, rok) zostają w rękach admina.

## Zakres
- [ ] Odczyt stanu bieżącego: `EditProjectDialog`, polityka UPDATE na `dcs.mdr_settings` (baza ma już dopuszczać DC — potwierdzić odczytem `pg_policy`), akcja zapisu
- [ ] DC tego projektu widzi edycję ustawień DCS; pola z `public.projects` dla DC tylko do odczytu
- [ ] Admin bez zmian (edytuje wszystko jak dziś)

## Gotowe, gdy
- DC projektu zapisuje zmianę cyklu i budżetu — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym (Preview → scl-dev), stan „w toku” do momentu, gdy odświeżone dane są w DOM (reguła z 1b.09, `docs/03-conventions.md`)
- red proof: DC innego projektu i zwykły członek dostają odmowę od bazy (nie tylko ukryty przycisk) — **jak sprawdzić**: test pgTAP na `dcs.mdr_settings` (UPDATE jako DC innego projektu → 0 wierszy / błąd)
- DC nie zmieni nazwy ani klienta projektu — **jak sprawdzić**: pola nieaktywne w oknie + polityka `public.projects` bez zmian (`git diff origin/main -- supabase/migrations` nie dotyka `public.projects`)
- zmiany w dzienniku zmian — **jak sprawdzić**: SELECT z `public.audit_log` dla `mdr_settings` na scl-dev

## Poza zakresem
- zmiana uprawnień `public.projects` (tabela Timesheeta) — decyzja tj 2026-09-23: nie
- kod projektu — niezmienny (1a.17c)

## Bramki STOP
- jeśli okaże się, że polityka `dcs.mdr_settings` NIE dopuszcza DC: stop, pokaż diff polityki względem baseline przed napisaniem migracji
- merge do `main` = produkcja DCS i Timesheet

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/02-data-model.md` (O-13: podział pól `projects` / `mdr_settings`)
- `apps/dcs/app/(app)/admin/projects/[projectId]/page.tsx`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23. Zakres: tylko ustawienia DCS (`dcs.mdr_settings`); nazwa i klient zostają dla admina.
