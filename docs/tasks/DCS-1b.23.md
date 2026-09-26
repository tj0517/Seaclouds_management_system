---
id: DCS-1b.23
title: "Profil dokumentu: bez technicznego Document ID, pliki w „Current revision” tylko z nazwą"
status: review
kind: code             # code | client | ops | milestone
difficulty: S
model: null
model_approved: null
effort: null
branch: feat/dcs-1b23-profile-cleanup
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
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
