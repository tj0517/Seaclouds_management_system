---
id: DCS-2.21
title: "Adnotacje na PDF w podglądzie: pinezka, obszar, tekst, lista komentarzy"
status: todo
kind: code             # code | client | ops | milestone
difficulty: XL
model: null
model_approved: null
effort: null
branch: null
due: null
depends_on: [DCS-2.20, DCS-2.09]
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
---

# DCS-2.21 — Adnotacje na PDF w podglądzie: pinezka, obszar, tekst, lista komentarzy

## Cel
Recenzent komentuje bezpośrednio na rysunku: stawia pinezkę lub zaznacza obszar i wpisuje uwagę. Obok podglądu jest lista komentarzy; kliknięcie przenosi do miejsca na rysunku. To realizacja „opcji 3” wybranej przez klienta. Komentarze zapisują się w modelu z DCS-2.09, więc trafiają do dziennika zmian i do Comment Sheet (DCS-2.10).

## Zakres
- [ ] Odczyt stanu bieżącego: przeglądarka z DCS-2.20, model adnotacji z DCS-2.09
- [ ] Warstwa adnotacji nad PDF.js: pinezka, prostokąt/obszar, komentarz tekstowy
- [ ] Pozycja zapisywana względnie do strony (niezależna od powiększenia)
- [ ] Lista komentarzy obok podglądu, nawigacja do miejsca, filtr po autorze / statusie
- [ ] Uprawnienia: dodaje recenzent przypisany do rewizji; czytają role DCS projektu
- [ ] Rewizja finalna / zamknięty przegląd — adnotacje tylko do odczytu

## Gotowe, gdy
- adnotacja postawiona na stronie 2 przy powiększeniu 200% wraca w tym samym miejscu przy 100% po przeładowaniu — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym (Preview → scl-dev), stan „w toku” do momentu, gdy odświeżone dane są w DOM (reguła z 1b.09, `docs/03-conventions.md`)
- red proof: użytkownik bez prawa komentowania nie doda adnotacji (odmowa bazy) — **jak sprawdzić**: test pgTAP / komunikat błędu
- red proof: adnotacja na rewizji finalnej odrzucona — **jak sprawdzić**: test pgTAP
- działa na rysunku wielkoformatowym od klienta — **jak sprawdzić**: dowód na pliku z 2.20

## Poza zakresem
- chmurki rewizyjne, wymiary, stemple (narzędzia klasy Bluebeam) — poza zakresem O-18
- PDF z wtopionymi komentarzami → O-19
- odpowiedzi Originatora → DCS-2.11

## Bramki STOP
- przed dodaniem kolejnej biblioteki poza PDF.js — pokaż uzasadnienie i czekaj

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`, `docs/04-open-questions.md` (O-18, O-19)

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23. Opcja 3 — komentowanie na PDF; własne na PDF.js. Zadanie prawdopodobnie do podziału na 2 PR-y przy /wf-task (warstwa + lista).
