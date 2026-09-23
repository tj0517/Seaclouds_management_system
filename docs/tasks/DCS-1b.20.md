---
id: DCS-1b.20
title: "Tabela dokumentów projektu: pełne nazwy typu, dyscypliny i obszaru"
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

# DCS-1b.20 — Tabela dokumentów projektu: pełne nazwy typu, dyscypliny i obszaru

## Cel
Tabela dokumentów projektu pokazuje dziś same kody (XD, ME, A01), które nic nie mówią osobie spoza Document Control. Kolumny mają pokazywać „kod — nazwa”.

## Zakres
- [ ] Odczyt stanu bieżącego: `app/(app)/projects/[projectId]/documents/page.tsx`, pomocnik `dictionaryLabel` w `lib/document-profile.ts`
- [ ] Kolumny Type, Discipline, Area (i Lang dla spójności) jako „kod — nazwa”, bez rozjeżdżania tabeli (skracanie z pełną nazwą w podpowiedzi)

## Gotowe, gdy
- kolumny pokazują „kod — nazwa” — **jak sprawdzić**: dowód przeglądarkowy na Preview (scl-dev)
- dokument wskazujący na nieaktywny wpis słownika nadal się wyświetla — **jak sprawdzić**: dezaktywacja wpisu na scl-dev + zrzut

## Poza zakresem
- rejestr MDR `/mdr` (ma własny układ kolumn z zał. C)

## Bramki STOP
—

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23.
