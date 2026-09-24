---
id: DCS-1b.08b
title: "Stan „w toku\" w oknie New Revision (przycisk zapisu bez informacji zwrotnej)"
status: review
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
pr: 94
notion: https://app.notion.com/p/3e2c2fbc059581f084eee5e9b40f9310
---

# DCS-1b.08b — Stan „w toku" w oknie New Revision (przycisk zapisu bez informacji zwrotnej)

## Cel
Przycisk zapisu w oknie New Revision ma pokazywać, że akcja trwa, i chronić przed podwójnym wysłaniem — spójnie z tym, co 1b.09 zrobiło dla Add File.

## Zakres
- [x] Odczyt stanu bieżącego (dodane przy imporcie)
- [x] Przycisk zapisu w New Revision: stan „w toku” (disabled + etykieta/spinner) od kliknięcia do zatwierdzenia drzewa, spójny z tym, co 1b.09 robi dla Add File
- [x] Ochrona przed podwójnym wysłaniem
- [x] Przejrzeć pozostałe dialogi z zapisem na profilu dokumentu — ten sam wzorzec, bez rozszerzania zakresu na inne ekrany (Approve revision, Void document — naprawione; Add File, status controls, CPY już zgodne)

## Gotowe, gdy
- New Revision: na buildzie produkcyjnym, od kliknięcia do wiersza nowej rewizji w DOM każda próbka pokazuje wskaźnik lub wiersz, okno otwarte do tego czasu — **jak sprawdzić**: `e2e:revision` (`armSampler`) + czerwony dowód
- Approve revision i Void document: ta sama własność — **jak sprawdzić**: `e2e:status` (`armSampler`) + czerwony dowód dla każdego
- Podwójne kliknięcie „Create revision” tworzy dokładnie jedną rewizję (double click i dwa `form.requestSubmit()`) — **jak sprawdzić**: `count(*)` w lokalnej `dcs.revisions`, drukowane przez `e2e:revision`
- `e2e:revision`, `e2e:status` zielone na buildzie produkcyjnym; `e2e:profile` nadal zielone — **jak sprawdzić**: przebiegi wszystkich trzech

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
- 2026-09-24: zaimplementowane — `NewRevisionDialog`, `ApproveRevisionButton`, `VoidDocumentDialog` (`apps/dcs/components/document-profile/`) trzymają dialog otwarty (wzorzec `AddFileDialog` z 1b.09: `closeWhenRefreshed` + `usePendingAction().refresh()`/`navigate()`) aż odświeżone dane wylądują w DOM. `NewRevisionDialog` przeszedł z lokalnego `useTransition()` na hook'owy `navigate()`; przy okazji naprawiony bug: efekt pobierający propozycję kodu zależał od `open`, które po auto-zamknięciu nigdy nie wraca na `false` — drugie otwarcie okna nie odpalało nowego zapytania i pole SCL zostawało na „…” na zawsze; poprawka: zależność efektu na `shown` (faktyczna widoczność) zamiast `open`.
  Dowód próbkowania DOM (`armSampler`, przeniesiony z `revision-files.mjs` do `e2e/support.mjs` — trzeci skrypt, wpis (yy)): `e2e:revision` 43/43 (w tym double-click i dwa `form.requestSubmit()` na `dcs.revisions`: `3 -> 4`, `4 -> 5`), `e2e:status` 33/33 (w tym double-click na Approve: `1 locked revisions`, i na Void: `1 audit rows`). `e2e:profile` 40/40 bez zmian. `e2e:files` 55/55 asercji przed nieistotnym `sips` (macOS-only, brak na tej maszynie — `docs/deferred-tasks.md` (iii)) — sekcje h/3 i h/5 (używają `armSampler`) zielone, potwierdzają, że przeniesienie nie zmieniło zachowania.
  Czerwone dowody (po jednym na dialog, cofnięte, niescommitowane): New Revision — `stale: [...]`/`closed-early: [...]`; Approve — `closed-early: [{"indicator":true,"row":false}]`; Void — analogicznie. Wszystkie trzy: `PASS` po przywróceniu poprawki.
  Dowód w przeglądarce (localhost:3001, build produkcyjny, Playwright MCP, `dc.profile@local.test` po aal2, dokument `SC2602-SCL-RA-0001-EN`): stan „w toku” złapany throttlingiem sieci (CDP `Network.emulateNetworkConditions`, latency 900 ms) — `.playwright-mcp/1b08b-{new-revision,approve,void}-{pending,after}.png` (gitignored, nie w tym PR).
  `pnpm typecheck`/`lint`/`test:unit` czyste, 605/605.
  `docs/03-conventions.md`: tabela pokrycia hooka i linia „Stan” w sekcji „Stany ładowania w UI” zaktualizowane (New Revision + Approve/Void jako domknięte, nie luka).
  Zamknięcie DCS-1b.20 (PR #93, scalone): `status: done` w tym samym pierwszym commicie tego PR-a.
  `status: review`, `pr: 94` ustawione w tym pliku i w INDEX. Nie scalone — PR czeka na tj.
