---
id: DCS-2.10
title: "Generowanie Comment Sheet w formacie SCMS-SCL-LA-0001"
status: todo
kind: code             # code | client | ops | milestone
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: 2026-11-06
depends_on: []
blocked_by_questions: []
touches_db: TODO
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581d18802dc3bf6086b85
---

# DCS-2.10 — Generowanie Comment Sheet w formacie SCMS-SCL-LA-0001

## Cel
Nazwa pliku: `[NR]_[REV]_COM.xlsx`. Arkusz dołączany do kolejnej rewizji jako załącznik.

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Szablon xlsx
- [ ] Generowanie z komentarzy
- [ ] Nazewnictwo pliku
- [ ] Dołączenie do rewizji

## Gotowe, gdy
- TODO: strona w Notion nie definiuje kryteriów akceptacji (jest tylko lista kontrolna w „Zakres”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- Ref: brief sekcje 6.6, procedura 5.3 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581d18802dc3bf6086b85).
- 2026-09-22: `touches_db: TODO` — strona nie mówi, czy logika żyje w bazie (funkcje/triggery/constrainty), czy w aplikacji; do rozstrzygnięcia przed startem.
