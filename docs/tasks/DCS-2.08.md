---
id: DCS-2.08
title: "Blokada rozdziału obowiązków (Originator ≠ Checker, ale = Approver dozwolone)"
status: todo
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-30
depends_on: []
blocked_by_questions: []
touches_db: TODO
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc0595818ebdc3f3567e13121c
---

# DCS-2.08 — Blokada rozdziału obowiązków (Originator ≠ Checker, ale = Approver dozwolone)

## Cel
ZMIANA wg briefu §4: Originator NIE MOŻE być Checkerem tej samej rewizji, ALE MOŻE być jej Approverem. Wcześniejsze założenie blokowało obie role — jest nieaktualne.

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Walidacja Originator ≠ Checker
- [ ] Jawne dopuszczenie Originator = Approver
- [ ] Komunikat błędu
- [ ] Testy obu przypadków

## Gotowe, gdy
- TODO: strona w Notion nie definiuje kryteriów akceptacji (jest tylko lista kontrolna w „Zakres”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- Ref: brief sekcja 4 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc0595818ebdc3f3567e13121c).
- 2026-09-22: `touches_db: TODO` — strona nie mówi, czy logika żyje w bazie (funkcje/triggery/constrainty), czy w aplikacji; do rozstrzygnięcia przed startem.
