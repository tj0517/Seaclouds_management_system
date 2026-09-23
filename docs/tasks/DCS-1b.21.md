---
id: DCS-1b.21
title: "Słowniki: wyjaśnienie „Sort order” i „Est. budget (h)” w tabeli i formularzu"
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

# DCS-1b.21 — Słowniki: wyjaśnienie „Sort order” i „Est. budget (h)” w tabeli i formularzu

## Cel
Na prezentacji padło pytanie, co znaczą kolumny „Sort order” i „Budget hours” w słownikach. Ekran ma to mówić sam: kolejność wpisu na listach wyboru oraz domyślna liczba godzin dla nowego dokumentu danego typu (Originator może ją nadpisać). Edytują DC i admin — tak już jest, bez zmian.

## Zakres
- [ ] Odczyt stanu bieżącego: `components/DictionaryTypeTable.tsx`, `components/DictionaryEntryDialog.tsx`
- [ ] Nazwa kolumny „Budget hours” → „Est. budget (h)”
- [ ] Jednozdaniowa podpowiedź przy obu kolumnach i polach formularza

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
