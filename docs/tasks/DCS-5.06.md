---
id: DCS-5.06
title: "Kopie zapasowe, retencja i TEST ODTWORZENIA"
status: todo
kind: ops             # code | client | ops | milestone
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-11-20
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: true
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581b6829de4db7b9272dd
---

# DCS-5.06 — Kopie zapasowe, retencja i TEST ODTWORZENIA

## Cel
Codziennie, retencja minimum 30 dni. Test odtworzenia obowiązkowy — kopia nieprzetestowana to brak kopii. Objąć także dane TES.

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Konfiguracja kopii bazy
- [ ] Konfiguracja kopii plików
- [ ] Polityka retencji
- [ ] TEST ODTWORZENIA

## Gotowe, gdy
—

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
### Ryzyko (ze strony Notion)
**RYZYKO: w planie klienta ten task wypada w tygodniu 13, a `2.18` (przejście zespołu na system) w tygodniu 11. Dwa tygodnie pracy na produkcji bez potwierdzonych kopii. Rozważyć przesunięcie do Fazy 1a — patrz nasze `1a.20`.**

- Ref: brief sekcja 3.5 · TJE
- Uwaga importu: strona DCS-5.11 mówi, że O-04 musi być rozstrzygnięte PRZED `5.06`; strona 5.06 tego nie wymienia, więc `depends_on` zostało puste.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581b6829de4db7b9272dd).
