---
id: DCS-1b.27
title: "Pola do wpisania odróżnione od pól automatycznych (tło i ramka)"
status: done
kind: code             # code | client | ops | milestone
difficulty: S
model: Sonnet
model_approved: null
effort: low
branch: feat/dcs-1b27-field-styles
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 102
---

# DCS-1b.27 — Pola do wpisania odróżnione od pól automatycznych

## Cel
Na prezentacji pola do wpisania wyglądały jak szare bloki, czyli jak coś wypełnianego automatycznie: mają przezroczyste tło na szarym tle strony. Użytkownik ma od razu widzieć, co wpisuje sam, a co ustala system.

## Zakres
- [ ] Odczyt stanu bieżącego: `apps/dcs/components/ui/input.tsx`, `textarea.tsx`, `SELECT_CLASS` (`AddMemberForm.tsx`), tło strony w `apps/dcs/app/globals.css`, miejsca z polami tylko do odczytu lub wyliczanymi (np. proponowany kod rewizji w New Revision)
- [ ] Pola edytowalne (input, textarea, select): białe tło i wyraźna ramka; fokus bez zmian
- [ ] Pola tylko do odczytu i wyliczane: tło szare, bez ramki pola
- [ ] Jedna definicja stylu w komponentach i tokenach, bez lokalnego nadpisywania tła w ekranach; tryb ciemny też

## Gotowe, gdy
- zrzuty przed i po: New Document, New Revision, Edit project, Dictionaries — **jak sprawdzić**: Playwright na buildzie produkcyjnym lokalnie, ścieżki w raporcie
- ramka pola edytowalnego ma kontrast co najmniej 3:1 do tła — **jak sprawdzić**: wartości kolorów z `globals.css` i wynik obliczenia w raporcie
- ekrany nie nadpisują tła pól lokalnie — **jak sprawdzić**: grep po klasach tła w miejscach użycia `Input`, `Textarea` i `SELECT_CLASS`, wynik w raporcie
- Timesheet nietknięty — **jak sprawdzić**: `git diff origin/main --stat` nie dotyka `apps/timesheet/` ani `packages/`

## Poza zakresem
- przebudowa formularzy i układu ekranów
- Timesheet
- kolory statusów MDR (O-05)

## Bramki STOP
- merge do `main` = produkcja DCS i Timesheet

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`
- `apps/dcs/app/globals.css`, `apps/dcs/components/ui/`

## Notatki z realizacji
- 2026-09-25 tj: ustalenie z klientem — pola input mają mieć kolor sugerujący wpisywanie; dziś szare bloki wyglądają jak pola automatyczne.
- 2026-09-26 tj: nowy token `--field-border` w `globals.css` (`:root` i `.dark`), `--input` bez zmian —
  `--input` napędza outline buttony, tor Switch i checkboxy i te mają wyglądać tak samo jak dziś.
- 2026-09-26 tj: edycja `components/ui/input.tsx` i `textarea.tsx` wprost dozwolona na ten task (precedens 1a.24).
- 2026-09-26 tj: kryterium poszerzone — każde self-styled surowe pole znalezione w kroku 1 (nie tylko
  `mdr/page.tsx:529`) ma trafić na wspólny styl.
- 2026-09-26 tj: `app/login` i `app/mfa` zostają nietknięte na ten task — ich pola są `border-gray-300`
  bez żadnych tokenów motywu, a etykiety/przyciski obok też są surowym szarym, nie tokenami; przestylowanie
  samych pól zostawiłoby ekran w gorszym, na wpół przestylowanym stanie. Odnotowane w
  `docs/deferred-tasks.md` (nnn) jako osobna, większa praca.
- Zrobione: `--field-border` (jasny 214 15% 55%, ciemny 215 14% 45%, oba ≥3:1 do bieli/`--background`/`--card`);
  `input.tsx`, `textarea.tsx`, `SELECT_CLASS` przeniesione na `bg-card` + `border-field-border`, z
  `read-only:`/`disabled:` na `bg-muted` bez ramki; `mdr/page.tsx:529` (`FilterSelect`) przeniesiony na
  `SELECT_CLASS`; surowy `<output>` (proponowany kod rewizji, krok non-editable w `NewRevisionDialog.tsx`)
  przestylowany na tę samą konwencję pól tylko-do-odczytu; wyjątek shadcn/ui dopisany w `CLAUDE.md`.
  Zrzuty przed/po w `.playwright-mcp/` (New Document, New Revision, Edit project — w tym pola read-only i
  scrollowany widok pól edytowalnych, Dictionaries — lista ze Switch i dialog edycji z polem read-only Code).
- 2026-09-26 tj: odbiór PR #102 — kontrast ramki ≥3:1 (3,52 / 3,21 do tła strony), brak lokalnych nadpisań tła pól,
  Timesheet i packages/ nietknięte (sprawdzone odczytem); wygląd obejrzany na Preview. Logowanie i MFA → deferred (nnn).
- 2026-09-26 tj: poprawka po odbiorze (PR #104) — wypełnienie pól edytowalnych = --field-bg (213 22% 98,5%), bez cienia; ramka bez zmian. Świadomie jeden PR z poprawką 1b.23.
