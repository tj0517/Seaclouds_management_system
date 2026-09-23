---
id: DCS-2.03
title: "Silnik obiegu: tryb szeregowy (IFR i wyżej)"
status: todo
kind: code             # code | client | ops | milestone
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-23
depends_on: []
blocked_by_questions: []
touches_db: TODO
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581b98d3be1ac38f99dbc
---

# DCS-2.03 — Silnik obiegu: tryb szeregowy (IFR i wyżej)

## Cel
Originator → Checker → Approver → Document Controller → powrót do Originatora.

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Logika trybu sequential
- [ ] Aktywacja kolejnego kroku
- [ ] Rola doc_controller jako sequence 3
- [ ] Testy

## Gotowe, gdy
- TODO: strona w Notion nie definiuje kryteriów akceptacji (jest tylko lista kontrolna w „Zakres”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- Ref: brief sekcje 7.3, 7.5 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581b98d3be1ac38f99dbc).
- 2026-09-22: `touches_db: TODO` — strona nie mówi, czy logika żyje w bazie (funkcje/triggery/constrainty), czy w aplikacji; do rozstrzygnięcia przed startem.
