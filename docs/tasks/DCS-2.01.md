---
id: DCS-2.01
title: "Schemat approval_tasks i comments"
status: todo
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-02
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581d1a0a2e1a86db36d78
---

# DCS-2.01 — Schemat approval_tasks i comments

## Cel
Jedna tabela obsługuje oba tryby obiegu — pole `mode`: parallel / sequential.

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Migracje SQL
- [ ] Polityki RLS
- [ ] Indeksy

## Gotowe, gdy
- TODO: strona w Notion nie definiuje kryteriów akceptacji (jest tylko lista kontrolna w „Zakres”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- Ref: brief sekcja 5.6 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581d1a0a2e1a86db36d78).
