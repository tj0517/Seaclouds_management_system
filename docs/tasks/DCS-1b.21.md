---
id: DCS-1b.21
title: "Słowniki: wyjaśnienie „Sort order” i „Est. budget (h)” w tabeli i formularzu"
status: done
kind: code             # code | client | ops | milestone
difficulty: S
model: sonnet
model_approved: null
effort: low
branch: feat/dcs-1b21-dictionary-hints
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 101
---

# DCS-1b.21 — Słowniki: wyjaśnienie „Sort order” i „Est. budget (h)” w tabeli i formularzu

## Cel
Na prezentacji padło pytanie, co znaczą kolumny „Sort order” i „Budget hours” w słownikach. Ekran ma to mówić sam: kolejność wpisu na listach wyboru oraz domyślna liczba godzin dla nowego dokumentu danego typu (Originator może ją nadpisać). Edytują DC i admin — tak już jest, bez zmian.

## Zakres
- [x] Odczyt stanu bieżącego: `components/DictionaryTypeTable.tsx`, `components/DictionaryEntryDialog.tsx`
- [x] Nazwa kolumny „Budget hours” → „Est. budget (h)”
- [x] Jednozdaniowa podpowiedź przy obu kolumnach i polach formularza

## Gotowe, gdy
- nagłówki i pola mają podpowiedź z treścią jak w Celu — **jak sprawdzić**: zrzut tabeli i otwartego formularza na Preview
- zmiana nazwy nie łamie testów słowników — **jak sprawdzić**: `pnpm --filter @scl/dcs test` zielone w CI

## Poza zakresem
- zmiana uprawnień do słowników

## Bramki STOP
—

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/00-glossary.md`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23.
- 2026-09-25 tj: przed napisaniem tekstu podpowiedzi potwierdzone w `DocumentCreateForm.tsx` (`onDocTypeChange`, `budgetHoursFromMeta`): budżet dokumentu jest podpowiadany z `meta` typu dokumentu i pole zostaje edytowalne — Originator może je nadpisać. Zgodne z Celem, bez rozbieżności — nie było potrzeby zatrzymania.
- 2026-09-25 tj: dowód przeglądarkowy od razu na lokalnym buildzie produkcyjnym (bez czekania na Preview PR-a) — ten sam powód co DCS-1b.19/1b.18, Preview jest pomijany przez Vercela (`CLAUDE.md`, „Ostatni odczyt”).
- 2026-09-25 tj: odbiór PR #101 — zmiana tylko w dwóch komponentach słowników (nazwa Est. budget (h) + podpowiedzi), podpowiedź o nadpisywaniu potwierdzona w DocumentCreateForm; testy/typecheck/lint zielone; zrzuty z lokalnego buildu (Preview pominięty).
