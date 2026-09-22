---
id: DCS-2.14
title: "Zmiana terminu etapu — przeniesienie do Forecast"
status: todo
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: 2026-11-06
depends_on: []
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3ccc2fbc059581ae9809da87e73764ce
---

# DCS-2.14 — Zmiana terminu etapu — przeniesienie do Forecast

## Cel
Brief §4: jeśli planowana data etapu się zmienia, zmiana idzie w datę FORECAST, nie w Planned.

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Zmiana terminu zapisywana w Forecast
- [ ] Planned pozostaje nienaruszona
- [ ] Przesunięcie kolejnych etapów w Forecast
- [ ] Pomijanie etapów z wypełnionym Actual
- [ ] Ekran podglądu zmian
- [ ] Zapis zbiorczy w audit logu

## Gotowe, gdy
—

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
- **UWAGA: §8.3.2 i §8.3.3 briefu wciąż opisują przeliczanie Planned — sprzeczność do usunięcia w rev. B (`P.02`).** (Strona nie nazywa tego wprost zależnością — `depends_on` pozostawione puste.)
- Ref: brief sekcje 4, 8.3.2 · TJE

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3ccc2fbc059581ae9809da87e73764ce).
