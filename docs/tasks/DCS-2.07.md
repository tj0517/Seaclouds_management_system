---
id: DCS-2.07
title: "Zamknięcie obiegu przez Document Controllera"
status: todo
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-30
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581718f31c76110342479
---

# DCS-2.07 — Zamknięcie obiegu przez Document Controllera

## Cel
BRAMKA KOŃCOWA. Tylko akcja DC zapisuje datę Actual i zmienia status w MDR.

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Akcja zamknięcia
- [ ] Zapis daty Actual
- [ ] Aktualizacja statusu
- [ ] Blokada dla pozostałych ról

## Gotowe, gdy
- TODO: strona w Notion nie definiuje kryteriów akceptacji (jest tylko lista kontrolna w „Zakres”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- Ref: brief sekcja 7.3 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581718f31c76110342479).
