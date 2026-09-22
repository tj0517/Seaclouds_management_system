---
id: DCS-2.12
title: "Daty Planned — wyliczenie jednorazowe przy tworzeniu MDR"
status: todo
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-30
depends_on: [DCS-P.02]
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc05958157a42bd515ce9ed722
---

# DCS-2.12 — Daty Planned — wyliczenie jednorazowe przy tworzeniu MDR

## Cel
Brief §4: Planned ustawiana JEDNORAZOWO przy tworzeniu MDR. Data kotwicząca (start IDC) → system wylicza resztę z cyklu 7/10/7, dni kalendarzowe. Późniejsze zmiany terminów NIE modyfikują Planned — idą w Forecast (`2.14`).

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Algorytm wyliczania
- [ ] Data kotwicząca w kreatorze MDR
- [ ] Nadpisywanie ręczne przez DC
- [ ] Znacznik `planned_overridden`
- [ ] Blokada zmiany Planned po utworzeniu dokumentu

## Gotowe, gdy
—

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- **Zależność: wymaga rozstrzygnięcia sprzeczności §8.3.2/§8.3.3 vs §4 — patrz `P.02`.**
- Powiązane: zmiany terminów po utworzeniu obsługuje `2.14` (Forecast).
- Ref: brief sekcje 4, 8.1, 8.3.1 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc05958157a42bd515ce9ed722).
