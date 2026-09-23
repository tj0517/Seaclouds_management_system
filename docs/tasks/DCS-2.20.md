---
id: DCS-2.20
title: "Podgląd PDF w profilu dokumentu (PDF.js)"
status: todo
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
---

# DCS-2.20 — Podgląd PDF w profilu dokumentu (PDF.js)

## Cel
Plik PDF rewizji jest widoczny w DCS bez pobierania. To fundament komentowania na rysunku (DCS-2.21), więc podgląd od razu powstaje na PDF.js — tej samej bibliotece, na której staną adnotacje (decyzja tj 2026-09-23, O-18).

## Zakres
- [ ] Odczyt stanu bieżącego: `lib/files.ts` (signed URL, 60 s, polityka bajtów tylko dla ról DCS), `RevisionFileList.tsx`
- [ ] Przeglądarka PDF.js w profilu dokumentu dla plików PDF: przewijanie stron, powiększenie, dopasowanie do szerokości
- [ ] Dostęp przez ten sam mechanizm co pobieranie (bez nowej ścieżki do bajtów)
- [ ] Inne formaty: tylko pobieranie, jak dziś
- [ ] Test wydajności na prawdziwym rysunku wielkoformatowym od klienta (A0 / wielostronicowy)

## Gotowe, gdy
- PDF bieżącej rewizji wyświetla się w profilu — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym (Preview → scl-dev), stan „w toku” do momentu, gdy odświeżone dane są w DOM (reguła z 1b.09, `docs/03-conventions.md`)
- red proof: użytkownik bez roli DCS nie dostaje podglądu — **jak sprawdzić**: dowód na koncie przypisanym tylko w Timesheecie
- duży rysunek od klienta otwiera się w akceptowalnym czasie — **jak sprawdzić**: pomiar czasu do pierwszej strony podany w raporcie (plik i rozmiar)
- zależność PDF.js przypięta w `docs/toolchain.md` — **jak sprawdzić**: diff

## Poza zakresem
- adnotacje → DCS-2.21
- podgląd DWG / DOCX / XLSX
- automatyczne PDF rendition → O-09

## Bramki STOP
- zmiana polityki bucketa `dcs-documents` — pokaż diff i czekaj

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/toolchain.md`, `docs/04-open-questions.md` (O-16, O-18)

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23. Klient chce komentowania bezpośrednio na PDF (opcja 3); technologia: własna na PDF.js (O-18).
