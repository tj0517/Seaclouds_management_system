---
id: DCS-2.02
title: "Silnik obiegu: tryb równoległy (IDC)"
status: todo
kind: code             # code | client | ops | milestone
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-16
depends_on: []
blocked_by_questions: []
touches_db: TODO
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc0595811cb0cae25f98b5a40c
---

# DCS-2.02 — Silnik obiegu: tryb równoległy (IDC)

## Cel
Etap kończy się, gdy WSZYSTKIE zadania o `sequence=1` mają status Completed.

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Logika trybu parallel
- [ ] Warunek zamknięcia etapu
- [ ] Ukrycie ocen do zamknięcia etapu
- [ ] Konsolidacja ocen przez Checkera przy wielu recenzentach
- [ ] Testy

## Gotowe, gdy
- TODO: strona w Notion nie definiuje kryteriów akceptacji (jest tylko lista kontrolna w „Zakres”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- Ref: brief sekcje 7.2, 7.5 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc0595811cb0cae25f98b5a40c).
- 2026-09-22: `touches_db: TODO` — strona nie mówi, czy logika żyje w bazie (funkcje/triggery/constrainty), czy w aplikacji; do rozstrzygnięcia przed startem.
