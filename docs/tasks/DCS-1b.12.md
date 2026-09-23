---
id: DCS-1b.12
title: "Analiza pliku SCL_SMDR_v4.xlsx: rozbieżności, puste daty, numery spoza formatu, mapowanie kolorów"
status: blocked
kind: code             # code | client | ops | milestone
difficulty: M
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
notion: https://app.notion.com/p/3c7c2fbc0595814cb418f772869cad16
---

# DCS-1b.12 — Analiza pliku SCL_SMDR_v4.xlsx: rozbieżności, puste daty, numery spoza formatu, mapowanie kolorów

## Cel
Zanim powstanie import, ustalić, jak brudne są dane w `SCL_SMDR_v4.xlsx` — ukryte niespójności wychodzą dopiero przy imporcie i potrafią zjeść drugie tyle czasu.

## Zakres
Skrypt Python/pandas, wynik jako raport .md.
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Numery dokumentów: ile pasuje do wzorca pięciopolowego, jakie są odstępstwa (brief §13.2: Transmittals używa formatu siedmiopolowego `SC24001-SCL-00-X01-AA-0001-EN` → pole 3 = area, pole 4 = discipline)
- [ ] Prefiks projektu: `SC` vs `SCL` (procedura mówi SCL, praktyka SC — D-02)
- [ ] Duplikaty numerów, puste tytuły, typy spoza 23 kodów
- [ ] Puste daty i rewizje — ile dokumentów bez żadnej rewizji (→ import ze statusem Not started)
- [ ] Inicjały w Orig/Ch'd/App'd — czy wszystkie mapują się na profile
- [ ] Kolumna E (kolor statusu) — lista unikalnych wartości do mapowania na `workflow_status` (O-05)
- [ ] Daty Planned/Forecast/Actual per etap — format, luki, daty w przyszłości
- [ ] Transmittals: struktura, czy numery dokumentów w wysyłkach istnieją w SMDR

## Gotowe, gdy
- Raport z liczbami i listą decyzji do podjęcia przez DC przed importem (np. „12 dokumentów ma typ spoza listy — zmapować na X czy Void?”) — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
Brief (§13): źródłem migracji jest `SCL_SMDR_v4.xlsx` — 146 dokumentów w arkuszu SMDR (38 kolumn), 14 projektów, 9 słowników w Legend, macierz cykli w Input, rejestr wysyłek w Transmittals. Zanim napiszemy import, musimy wiedzieć, jak brudne są dane — ukryte niespójności wychodzą dopiero przy imporcie i potrafią zjeść drugie tyle czasu.

- O-05 (mapowanie kolorów kolumny E na `workflow_status`) otwarte; zadanie ma dostarczyć listę wartości do tej decyzji.

## Notatki z realizacji
- 2026-09-23 tj: import SMDR z klientem odłożony — status blocked, termin zdjęty (poprzedni: 2026-09-10); nowy termin przy wznowieniu łańcucha 1a.19 / 1b.12 → 1b.13 → 1b.14 → 1b.15.
- 2026-09-22 (import): zadanie dostarcza materiał do rozstrzygnięcia O-05 (mapowanie kolorów), więc nie jest nim zablokowane; blokada zdjęta przy imporcie.
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc0595814cb418f772869cad16).
