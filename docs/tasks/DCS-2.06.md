---
id: DCS-2.06
title: "Obsługa odrzucenia dokumentu"
status: todo
kind: code             # code | client | ops | milestone
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-23
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581559d86ce495c3a44b8
---

# DCS-2.06 — Obsługa odrzucenia dokumentu

## Cel
Kod 3 anuluje pozostałe zadania Pending tej rewizji ze statusem Cancelled. Anulowane zadania zostają jako ślad.

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Anulowanie zadań Pending
- [ ] Powrót do Originatora
- [ ] Zachowanie śladu
- [ ] Testy

## Gotowe, gdy
- TODO: strona w Notion nie definiuje kryteriów akceptacji (jest tylko lista kontrolna w „Zakres”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- Ref: brief sekcja 7.5 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581559d86ce495c3a44b8).
