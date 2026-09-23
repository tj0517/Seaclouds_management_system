---
id: DCS-0.1
title: "Zamknąć warunki wejścia Fazy 1 (punkty otwarte O-01/03/04/05/06, słowniki od DC, zamrożony SMDR, dostępy)"
status: dropped
kind: client             # code | client | ops | milestone
difficulty: S
model: null
model_approved: null
effort: null
branch: null
due: 2026-08-30
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
notion: https://app.notion.com/p/3c7c2fbc05958127bc16e39cc288f5cd
---

# DCS-0.1 — Zamknąć warunki wejścia Fazy 1 (punkty otwarte O-01/03/04/05/06, słowniki od DC, zamrożony SMDR, dostępy)

## Cel
Zebrać decyzje i materiały, bez których nie da się zaprojektować schematu ani zrobić importu: punkty otwarte O-01/03/04/05/06, ostateczne słowniki od DC, zamrożona wersja `SCL_SMDR_v4.xlsx` i dostępy.

## Zakres
- [ ] Odczyt stanu bieżącego: które z punktów O-01/03/04/05/06 są już rozstrzygnięte w `docs/04-open-questions.md` (dodane przy imporcie)
- [ ] **O-04** okres retencji audit logu i kopii zapasowych (RODO) — decyduje MD
- [ ] **O-05** mapowanie kolorów z kolumny E arkusza SMDR na `workflow_status` — decyduje DC
- [ ] **O-06** kody CTR wspólne dla firmy czy per projekt — decyduje MD
- [ ] Ostateczna lista słowników od DC: 23 typy dokumentów z budżetami (zał. A), obszary, dyscypliny, języki (zał. B)
- [ ] Zamrożona wersja `SCL_SMDR_v4.xlsx` — od tej daty zmiany w Excelu muszą być logowane, inaczej import się nie zgodzi
- [ ] Dostępy (wymienione w tytule i w „Gotowe, gdy”; strona nie precyzuje, jakie)

## Gotowe, gdy
- Wszystkie odpowiedzi zapisane w rejestrze decyzji (sekcja 14 briefu) — **jak sprawdzić**: TODO
- Mamy dostępy — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
Brief (sekcja 16) zostawia 10 punktów otwartych. Część z nich blokuje projekt schematu bazy — bez decyzji o kodach CTR (O-06) nie wiadomo, czy `sub_projects` zostaje per projekt, a bez mapowania kolorów (O-05) import z Excela nie ma jak ustawić statusów.

- Tytuł wymienia O-01 i O-03, treść strony ich nie rozwija (lista zawiera tylko O-04, O-05, O-06).
- O-03 rozstrzygnięte: hosting na Vercelu.
- Stan punktów wg `open-questions.txt` przy imporcie: O-01 otwarty (tylko naming portalu); O-04 otwarty; O-05 otwarty (nie blokuje rejestru 1b.05, paleta tymczasowa); O-06 otwarty (schemat w wariancie per projekt).

## Notatki z realizacji
- 2026-09-23 tj: dropped — rozbite: warunki wejścia importu (zamrożony SMDR, odpowiedź na O-05) przeniesione do DCS-1b.13; O-04 → DCS-5.11; O-03 rozstrzygnięte; O-01/O-06 żyją w docs/04-open-questions.md; zależność DCS-1b.14 przepięta na DCS-1b.13.
- 2026-09-22 (import): zadanie służy rozstrzygnięciu O-01, O-04, O-05, O-06, więc nie jest nim zablokowane; blokada zdjęta przy imporcie.
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc05958127bc16e39cc288f5cd).
