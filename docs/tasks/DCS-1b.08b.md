---
id: DCS-1b.08b
title: "Stan „w toku\" w oknie New Revision (przycisk zapisu bez informacji zwrotnej)"
status: in_progress
kind: code             # code | client | ops | milestone
difficulty: M
model: Sonnet
model_approved: null
effort: medium
branch: fix/profile-dialogs-pending-until-refresh
due: 2026-09-29
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: null
notion: https://app.notion.com/p/3e2c2fbc059581f084eee5e9b40f9310
---

# DCS-1b.08b — Stan „w toku" w oknie New Revision (przycisk zapisu bez informacji zwrotnej)

## Cel
Przycisk zapisu w oknie New Revision ma pokazywać, że akcja trwa, i chronić przed podwójnym wysłaniem — spójnie z tym, co 1b.09 zrobiło dla Add File.

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] Przycisk zapisu w New Revision: stan „w toku” (disabled + etykieta/spinner) od kliknięcia do zatwierdzenia drzewa, spójny z tym, co 1b.09 robi dla Add File
- [ ] Ochrona przed podwójnym wysłaniem
- [ ] Przejrzeć pozostałe dialogi z zapisem na profilu dokumentu — ten sam wzorzec, bez rozszerzania zakresu na inne ekrany

## Gotowe, gdy
- Na buildzie produkcyjnym: stan „w toku” widoczny od kliknięcia do końca zapisu — **jak sprawdzić**: dowód przeglądarkowy na buildzie produkcyjnym
- Podwójne kliknięcie nie tworzy dwóch rewizji — **jak sprawdzić**: dowód w bazie
- `e2e:revision` zielone — **jak sprawdzić**: przebieg `e2e:revision`

## Poza zakresem
Inne ekrany niż profil dokumentu („bez rozszerzania zakresu na inne ekrany”).

## Bramki STOP
—

## Kontekst
Zgłoszone przez tj 21.09 przy teście 1b.09 na Preview: po kliknięciu zapisu w oknie New Revision przycisk nie pokazuje, że akcja trwa — użytkownik nie wie, czy kliknięcie zadziałało. Przy 3–4 s na zapis (Preview) to wygląda jak zawieszenie i zachęca do podwójnego kliknięcia.

Ten sam problem w Add File naprawiany w PR #81 (1b.09); tu dotyczy kodu z 1b.08, stąd osobne zadanie.

- Uwaga importu: strona odsyła do 1b.08 (kod) i 1b.09 (wzorzec), ale nie formułuje ich jako zależności — `depends_on` puste. Oba zadania są Done.

## Notatki z realizacji
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3e2c2fbc059581f084eee5e9b40f9310).
- 2026-09-22 tj (Preview, next 16.2.12): po zapisie New Revision okno znika ~1 s przed pojawieniem się rewizji na liście — ta luka należy do 1b.08b; okno ma zostać otwarte (stan „w toku”) do momentu, gdy odświeżona lista jest w DOM (reguła z 1b.09, 03-conventions).
- 2026-09-24 tj: zakres rozszerzony na Approve revision i Void document (ten sam błąd zamknięcia przed odświeżeniem), każde z dowodem próbkowania; trudność S → M.
