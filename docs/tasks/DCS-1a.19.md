---
id: DCS-1a.19
title: "Import 9 brakujących projektów z arkusza Projects (klient, cykl, role z Orig/Ch'd/App'd)"
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
touches_db: true
touches_prod: true
pr: null
notion: https://app.notion.com/p/3c7c2fbc059581f48704d5e3373c1c1a
---

# DCS-1a.19 — Import 9 brakujących projektów z arkusza Projects (klient, cykl, role z Orig/Ch'd/App'd)

## Cel
Dołożyć do bazy 9 brakujących projektów z arkusza Projects i uzupełnić wszystkie 14 o klienta, cykl i role — warunek bramki 1a → 1b i podstawa importu dokumentów w 1b.

## Zakres
- [ ] Odczyt stanu bieżącego: które projekty są w bazie i z jakimi polami (dodane przy imporcie)
- [ ] Wyeksportować arkusze Projects i Input z Excela do CSV
- [ ] Mapowanie inicjałów (arkusz Input) na 14 istniejących profili — brakujące osoby zaprosić jako konta (TES `inviteUser`) lub zapisać jako „do zaproszenia”
- [ ] Dla każdego projektu: `project_code`, nazwa, klient (utworzyć w `clients`, jeśli brak), `process_type`, rok z kodu, cykl 7/10/7 jako start (D-14: macierz czasów z arkusza Input NIE jest stosowana)
- [ ] Role z kolumn Orig / Ch'd / App'd arkusza SMDR (per projekt, zdedup) → `project_roles`
- [ ] Skrypt jednorazowy (TS lub SQL) w `scripts/`, uruchamiany najpierw na dev, potem na prod
- [ ] Istniejące 5 projektów: tylko UPDATE nowych pól, nie ruszać `id` (FK z `timesheet_entries`)

## Gotowe, gdy
- 14 projektów w bazie z klientem, cyklem i co najmniej jednym DC — **jak sprawdzić**: TODO
- Lista w `/dcs` pokrywa się z arkuszem — **jak sprawdzić**: TODO

## Poza zakresem
—

## Bramki STOP
—

## Kontekst
Arkusz Projects w `SCL_SMDR_v4.xlsx` ma 14 projektów; w TES jest 5 z nich (SC2505, SC2510, SC2601, SC2602, SC2605). Brakujące 9 trzeba dołożyć, a wszystkie 14 uzupełnić o klienta, cykl i role — to warunek bramki 1a → 1b i podstawa importu dokumentów w 1b.

## Notatki z realizacji
- 2026-09-23 tj: import SMDR z klientem odłożony — status blocked, termin zdjęty (poprzedni: 2026-09-09); nowy termin przy wznowieniu łańcucha 1a.19 / 1b.12 → 1b.13 → 1b.14 → 1b.15.
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc059581f48704d5e3373c1c1a).
