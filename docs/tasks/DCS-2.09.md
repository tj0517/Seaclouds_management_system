---
id: DCS-2.09
title: "Komentarze do rewizji jako adnotacje na PDF: model danych, Review ID"
status: todo
kind: code             # code | client | ops | milestone
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-10-30
depends_on: [DCS-2.01, DCS-2.20]
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc05958185b650f75a3e329e7e
---

# DCS-2.09 — Komentarze do rewizji jako adnotacje na PDF: model danych, Review ID

## Cel
Model komentarzy do rewizji jako **adnotacji na PDF**: każdy komentarz należy do rewizji i pliku, ma stronę i położenie na rysunku (punkt lub obszar), autora, Review ID, treść i status. To warstwa danych pod narzędzia z DCS-2.21 i eksport Comment Sheet (DCS-2.10). Klient wybrał komentowanie bezpośrednio na PDF (tj 2026-09-23).

## Zakres
- [ ] Odczyt stanu bieżącego (repo, schemat `dcs.*`, powiązane zadania) przed zmianami (dodane przy imporcie)
- [ ] Model komentarzy: tabela `dcs.*` z `project_id`, powiązanie z rewizją i plikiem, strona + położenie względne, Review ID; RLS + polityki + test pgTAP w tym samym PR
- [ ] Blokada zapisu na rewizji finalnej (trigger w bazie, spójnie z 1b.10)
- [ ] Review ID
- [ ] Widok komentarzy w profilu dokumentu
- [ ] Powiązanie z rewizją

## Gotowe, gdy
- tabela komentarzy z RLS i testem pgTAP w tym samym PR — **jak sprawdzić**: `supabase test db` zielone, lista testów w raporcie
- red proof: osoba spoza projektu nie czyta ani nie dodaje komentarza — **jak sprawdzić**: test pgTAP
- red proof: komentarz do rewizji finalnej odrzucony przez bazę — **jak sprawdzić**: test pgTAP
- zmiany komentarzy w dzienniku zmian — **jak sprawdzić**: SELECT z `public.audit_log` na scl-dev

## Poza zakresem
- narzędzia rysowania w podglądzie → DCS-2.21
- eksport → DCS-2.10

## Bramki STOP
- zmiana enuma / funkcji wołanej z RLS — diff względem baseline przed migracją
- merge do `main` = produkcja

## Kontekst
- Ref: brief sekcja 9.3, zał. D · TJE

## Notatki z realizacji
- 2026-09-23 tj: przepisane pod komentowanie na PDF (opcja 3, uwagi z prezentacji); zależy od 2.01 (schemat approval_tasks/comments) i 2.20 (podgląd).
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc05958185b650f75a3e329e7e).
