---
id: DCS-1b.22
title: "Okno edycji dokumentu dla DC (bez pól tworzących numer SCL)"
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

# DCS-1b.22 — Okno edycji dokumentu dla DC (bez pól tworzących numer SCL)

## Cel
Po utworzeniu dokumentu da się dziś zmienić tylko numer CPY i status. DC ma móc poprawić tytuł, dyscyplinę, obszar, kod CTR, budżet godzin i zespół (Originator / Checker / Approver). Typ i język są częścią numeru SCL, więc zostają zablokowane — w oknie i w bazie.

## Zakres
- [ ] Odczyt stanu bieżącego: polityki UPDATE na `dcs.documents` (czy DC może aktualizować te kolumny), trigger blokujący zmianę `scl_doc_number`, istniejące akcje profilu
- [ ] Okno „Edit document” w profilu dokumentu, widoczne dla DC projektu i admina
- [ ] Typ, język, numer SCL tylko do odczytu w oknie
- [ ] Walidacja jak w formularzu New Document (CTR z tego projektu, osoby z rolami w projekcie)

## Gotowe, gdy
- DC zapisuje zmianę tytułu i budżetu — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym (Preview → scl-dev), stan „w toku” do momentu, gdy odświeżone dane są w DOM (reguła z 1b.09, `docs/03-conventions.md`)
- red proof: próba zmiany typu lub języka poza oknem (bezpośredni UPDATE jako DC) odrzucona przez bazę — **jak sprawdzić**: test pgTAP z oczekiwanym błędem
- red proof: zwykły członek projektu nie zmieni dokumentu — **jak sprawdzić**: test pgTAP
- zmiany w dzienniku zmian — **jak sprawdzić**: SELECT z `public.audit_log` dla `documents` na scl-dev
- dokument w stanie Void nie jest edytowalny — **jak sprawdzić**: test lub dowód w UI

## Poza zakresem
- zmiana typu / języka z nadaniem nowego numeru — decyzja tj 2026-09-23: nie
- edycja przez Originatora — nie teraz
- dane rewizji → Faza 2

## Bramki STOP
- zmiana polityki RLS lub triggera na `dcs.documents` — pokaż diff względem baseline przed napisaniem migracji
- merge do `main` = produkcja

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/02-data-model.md`
- `apps/dcs/components/document-profile/DocumentInformationTab.tsx`, `apps/dcs/app/(app)/documents/new/page.tsx`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23. Zakres: DC (i admin), bez typu i języka.
