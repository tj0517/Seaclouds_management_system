---
id: DCS-1b.23
title: "Profil dokumentu: bez technicznego Document ID, pliki w „Current revision” tylko z nazwą"
status: done
kind: code             # code | client | ops | milestone
difficulty: S
model: Sonnet
model_approved: null
effort: low
branch: feat/dcs-1b23-profile-cleanup
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 103
---

# DCS-1b.23 — Profil dokumentu: bez technicznego Document ID, pliki w „Current revision” tylko z nazwą

## Cel
Dwie drobne poprawki czytelności profilu dokumentu z prezentacji: techniczny identyfikator bazy nic nie mówi użytkownikowi, a panel bieżącej rewizji jest przeładowany szczegółami plików.

## Zakres
- [ ] Odczyt stanu bieżącego: `DocumentInformationTab.tsx` (Additional attributes), `CurrentRevisionPanel.tsx`, `RevisionFileList.tsx`
- [ ] Usunąć pole „Document ID” z Additional attributes
- [ ] W panelu Current revision lista plików pokazuje tylko nazwę (z pobieraniem); rozmiar, autor i data zostają w zakładce Revisions

## Gotowe, gdy
- brak Document ID w profilu — **jak sprawdzić**: zrzut Additional attributes na Preview
- panel Current revision pokazuje same nazwy plików, zakładka Revisions pełne dane — **jak sprawdzić**: dwa zrzuty na Preview
- testy e2e profilu dostosowane — **jak sprawdzić**: `e2e:profile` / `e2e:revision` zielone w raporcie

## Poza zakresem
- podgląd pliku → DCS-2.20

## Bramki STOP
—

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23. Document ID: usunąć.
- 2026-09-26 tj: panel Current revision pokazuje tylko nazwę pliku (bez kind/size/upload time/„Uploaded as”) — tylko nazwa, bez wariantu pośredniego.
- 2026-09-26 tj: zrzuty ekranu lokalnie (Playwright MCP) + tj ogląda Preview sam przy review — Preview stoi za logowaniem Vercela, lokalny Playwright go nie zobaczy.
- 2026-09-26 tj: `e2e:files` dodane do kryteriów odbioru — `revision-files.mjs` pokazuje pełne dane plików w zakładce Revisions, więc też jest tym dotknięte.
- 2026-09-26 tj: odbiór PR #103 — Document ID usunięty (tylko wyświetlanie), panel Current revision: nazwa + Pobierz, Revisions: pełne dane (jeden komponent, wariant compact); e2e przeniesione, nie osłabione; Timesheet i packages/ nietknięte (sprawdzone odczytem); wygląd obejrzany na Preview.
- 2026-09-26 tj: poprawka po odbiorze (PR #104) — w panelu Current revision przycisk Pobierz pod nazwą pliku; Revisions bez zmian. Świadomie jeden PR z poprawką 1b.27.
