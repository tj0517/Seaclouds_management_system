---
id: DCS-1b.14
title: "Przejście raportu rozbieżności z DC pozycja po pozycji + poprawki importu"
status: todo
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: 2026-09-28
depends_on: [DCS-0.1]
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3c7c2fbc059581908abeeca26cfe4d28
---

# DCS-1b.14 — Przejście raportu rozbieżności z DC pozycja po pozycji + poprawki importu

## Cel
Wyjaśnić raport rozbieżności importu w całości razem z DC i doprowadzić do jego podpisania — warunek zakończenia 1b (brief §13.3).

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Sesja robocza z DC (1–2 h, może być kilka): raport pozycja po pozycji — dla każdej: poprawić dane w Excelu, poprawić mapowanie w skrypcie, albo świadomie pominąć (z uzasadnieniem)
- [ ] Równolegle DC klika po MDR na dev i porównuje z arkuszem — losowe 20–30 dokumentów, w tym te „trudne”
- [ ] Wszystkie decyzje zapisane w raporcie (wersja 2) — to dokument odbioru
- [ ] Ponowne uruchomienie importu na dev po poprawkach → raport powinien być pusty lub zawierać tylko pozycje świadomie pominięte
- [ ] Uwzględnić zmiany w Excelu po dacie zamrożenia (DCS 0.1) — zapytać DC, czy coś doszło

## Gotowe, gdy
- DC podpisuje (mail) raport rozbieżności v2 jako wyjaśniony — **jak sprawdzić**: mail od DC

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
Brief (§13.3, warunek zakończenia 1b): import uznaje się za zakończony po potwierdzeniu przez DC, że rejestr w systemie odpowiada plikowi, a raport rozbieżności został **wyjaśniony w całości**. To zadanie zależy od dostępności DC — największe ryzyko poślizgu w Fazie 1.

### Uwaga
Zmiany w Excelu po dacie zamrożenia (DCS 0.1) trzeba tu uwzględnić — zapytać DC, czy coś doszło.

- Uwaga importu: `depends_on` = 0.1 (data zamrożenia SMDR, wymieniona wprost). Raport rozbieżności to wynik DCS-1b.13, ale strona nie wymienia 1b.13 z numeru — nie dodano.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc059581908abeeca26cfe4d28).
