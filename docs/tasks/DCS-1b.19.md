---
id: DCS-1b.19
title: "DC edytuje ustawienia DCS projektu (cykle, budżet, numeracja CPY, status MDR)"
status: done
kind: code             # code | client | ops | milestone
difficulty: M
model: Sonnet 5
model_approved: null
effort: medium
branch: feat/dcs-1b19-dc-edits-dcs-settings
due: null
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: 99
---

# DCS-1b.19 — DC edytuje ustawienia DCS projektu (cykle, budżet, numeracja CPY, status MDR)

## Cel
DC prowadzi projekt w DCS samodzielnie, bez proszenia admina: zmienia cykle przeglądu, budżet godzin, numerację CPY i status MDR. Dziś przycisk „Edit” widzi wyłącznie admin. Dane wspólne z Timesheetem (nazwa, klient, typ procesu, rok) są w DCS tylko do odczytu dla wszystkich, także admina (ustalenie z klientem 2026-09-25); docelowo edytuje się je w portalu admina (ADR-0014).

## Zakres
- [x] Odczyt stanu bieżącego: `EditProjectDialog`, polityka UPDATE na `dcs.mdr_settings` (baza ma już dopuszczać DC — potwierdzić odczytem `pg_policy`), akcja zapisu
- [x] DC tego projektu i admin widzą edycję ustawień DCS
- [x] Pola z `public.projects` (nazwa, klient, typ procesu, rok) tylko do odczytu dla wszystkich, także admina, z dopiskiem, gdzie się je zmienia
- [x] Akcja zapisu (`updateProjectMdr`) przestaje wysyłać zmiany do `public.projects`

## Gotowe, gdy
- DC projektu zapisuje zmianę cyklu i budżetu — **jak sprawdzić**: dowód przeglądarkowy na LOKALNYM buildzie produkcyjnym via Playwright MCP (decyzja tj 2026-09-25, patrz Notatki), stan „w toku” do momentu, gdy odświeżone dane są w DOM (reguła z 1b.09, `docs/03-conventions.md`)
- red proof: DC innego projektu i zwykły członek dostają odmowę od bazy (nie tylko ukryty przycisk) — **jak sprawdzić**: test pgTAP na `dcs.mdr_settings` (UPDATE jako DC innego projektu → 0 wierszy / błąd)
- w DCS nikt (DC ani admin) nie zmieni nazwy, klienta, typu procesu ani roku projektu — **jak sprawdzić**: pola nieaktywne w oknie dla obu ról + test vitest: akcja zapisu odrzuca pola `public.projects` + `git diff origin/main -- supabase/migrations` nie dotyka `public.projects`
- zmiany w dzienniku zmian — **jak sprawdzić**: SELECT z `public.audit_log` dla `mdr_settings` LOKALNIE (decyzja tj 2026-09-25, patrz Notatki)

## Poza zakresem
- zmiana uprawnień `public.projects` (tabela Timesheeta) — decyzja tj 2026-09-23: nie
- edycja pól wspólnych w innym miejscu (portal admina, ADR-0014) → poza DCS; do tego czasu O-20
- kod projektu — niezmienny (1a.17c)

## Bramki STOP
- jeśli okaże się, że polityka `dcs.mdr_settings` NIE dopuszcza DC: stop, pokaż diff polityki względem baseline przed napisaniem migracji
- merge do `main` = produkcja DCS i Timesheet

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/02-data-model.md` (O-13: podział pól `projects` / `mdr_settings`)
- `apps/dcs/app/(app)/admin/projects/[projectId]/page.tsx`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23. Zakres: tylko ustawienia DCS (`dcs.mdr_settings`); nazwa i klient zostają dla admina.
- 2026-09-25 tj: ustalenie z klientem — w DCS nie edytuje się pól wspólnych projektu, także admin; tylko ustawienia DCS.
- 2026-09-25 tj: dowód akceptacyjny na LOKALNYM buildzie produkcyjnym przez Playwright MCP zamiast Preview → scl-dev; `public.audit_log` sprawdzony lokalnie zamiast na scl-dev — Vercel pominął Preview na PR #96/#98, a deploy scl-dev jest obecnie zepsuty.
- 2026-09-25 tj: odbiór PR #99 — udowodnione: DC własnego projektu zapisuje ustawienia DCS, DC innego projektu odrzucony przez bazę (pgTAP 5b/5c, członek — sekcja 2), zapis nie dotyka public.projects (parser + brak update w apps/dcs), pola Timesheeta disabled; UI zrzutami na WSL obejrzanymi przez tj; brak strażnika CPY-bez-klienta w bazie przy UPDATE → deferred (lll).
