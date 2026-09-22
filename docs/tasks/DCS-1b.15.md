---
id: DCS-1b.15
title: "Import na prod + pisemne potwierdzenie DC, że rejestr = plik; Excel do archiwum read-only"
status: todo
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: 2026-09-30
depends_on: [DCS-1b.14]
blocked_by_questions: []
touches_db: true
touches_prod: true
pr: null
notion: https://app.notion.com/p/3c7c2fbc0595815ea469d13bc8a3b449
---

# DCS-1b.15 — Import na prod + pisemne potwierdzenie DC, że rejestr = plik; Excel do archiwum read-only

## Cel
Kamień milowy Fazy 1b (brief §12.1): **„Excel przestaje być źródłem prawdy”**. Od tego dnia numery nadaje wyłącznie system, a arkusz jest archiwum.

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Backup prod przed importem (snapshot)
- [ ] Ostatnia synchronizacja: pobrać aktualny Excel od DC, diff względem wersji zamrożonej, dołożyć zmiany do CSV
- [ ] Uruchomić import na prod (ten sam skrypt, te same CSV, co na dev po 1b.14)
- [ ] Weryfikacja: liczba dokumentów, kilka losowych porównań z DC na żywo, test `next_doc_number` dla każdej serii
- [ ] DC potwierdza **pisemnie** (mail wystarczy), że rejestr = plik
- [ ] Excel: zapisać jako read-only w archiwum firmy z datą i adnotacją „superseded by SCL-DCS on YYYY-MM-DD”; komunikat do zespołu, że od dziś nowe dokumenty tylko w systemie

## Gotowe, gdy
- Mail z potwierdzeniem od DC — **jak sprawdzić**: mail od DC
- Pierwszy nowy dokument założony w systemie przez kogoś z zespołu (nie przez Ciebie) — **jak sprawdzić**: TODO

## Poza zakresem
- Pliki dokumentów: DC / originatorzy dołączają ręcznie do rewizji w kolejnych tygodniach (poza zakresem importu, §13.3) — warto ustalić priorytet: najpierw dokumenty aktywne.

## Bramki STOP
—

## Kontekst
Kamień milowy Fazy 1b z briefu (§12.1): **„Excel przestaje być źródłem prawdy”**. Od tego dnia numery nadaje wyłącznie system, a arkusz jest archiwum.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc0595815ea469d13bc8a3b449).
