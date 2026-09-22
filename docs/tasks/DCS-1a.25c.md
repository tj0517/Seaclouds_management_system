---
id: DCS-1a.25c
title: "Timesheet /mfa: test regresji w repo (Playwright, trzy tryby)"
status: in_progress
difficulty: M
model: null
model_approved: null
effort: null
branch: null
due: null
depends_on: [DCS-1a.25b, DCS-1b.07]
blocked_by_questions: []
touches_db: false
touches_prod: true
pr: null
notion: https://app.notion.com/p/3e1c2fbc0595817eae35ff537c8aed7a
---

# DCS-1a.25c — Timesheet /mfa: test regresji w repo (Playwright, trzy tryby)

## Cel
Zostawić w repo test, który złapie regresję zawieszenia `/mfa` („Verifying…” bez końca po poprawnym TOTP) w `apps/timesheet` — dotąd oba dowody red→green (1a.25, 1a.25b) były jednorazowymi skryptami ze scratchpada agenta.

## Zakres
- [ ] Odczyt stanu: `apps/dcs/e2e/` (konfiguracja, jak uruchamiany, dlaczego poza CI), `apps/timesheet/lib/mfa-navigation.ts`, `app/mfa/page.tsx`
- [ ] Test e2e w `apps/timesheet/e2e/` dla trzech trybów: **zweryfikowany czynnik**, **enrolment** (0 czynników), **pending** (czynnik niezweryfikowany)
- [ ] Asercja na kształcie nawigacji, nie tylko na URL-u: po submit pierwsze żądanie ma być `DOCUMENT` na ścieżkę docelową, nie samo `RSC /mfa?next=…`
- [ ] Przebieg pada na każdym błędzie konsoli/hydracji (jak skrypt z 1b.07)
- [ ] Poza CI, zgodnie z decyzją z 1b.07; sposób uruchamiania opisany w `docs/03-conventions.md`
- [ ] (rozszerzenie 20.09) Czerwony dowód na istniejących testach jednostkowych `safeNextPath` (vitest) na celowo zepsutym wariancie funkcji — patrz Notatki z realizacji

## Gotowe, gdy
- Test **czerwony na zrewertowanej poprawce** (`router.push` + `router.refresh` zamiast `navigateAfterMfaVerify`) i zielony na `main` — **jak sprawdzić**: oba przebiegi w raporcie, nie tylko zielony
- Trzy tryby pokryte osobnymi przypadkami — **jak sprawdzić**: TODO
- `pnpm-lock.yaml` bez zmian albo zmiana uzasadniona — **jak sprawdzić**: jedna linijka uzasadnienia w raporcie
- Kod aplikacji (`app/mfa/page.tsx`, `lib/mfa-navigation.ts`, `proxy.ts`) **bez zmian** — to zadanie dokłada test, nie dotyka zachowania — **jak sprawdzić**: TODO
- Sposób uruchomienia dopisany w `docs/03-conventions.md` obok wpisu z 1b.07 — **jak sprawdzić**: TODO
- (rozszerzenie 20.09) Test jednostkowy `safeNextPath` pokazany **na czerwono** na celowo zepsutym wariancie funkcji (np. zwracającym wejście bez zmian), nie tylko na zielono — **jak sprawdzić**: TODO

## Poza zakresem
Włączanie Playwrighta do CI; testy middleware/strażników w Timesheecie (osobny temat); walidacja `next` (1a.26); wspólna strona `/mfa` (ADR-0014); wygląd `/mfa`; baza.

## Bramki STOP
- Commit + PR, **STOP przed merge'em** — merge robi tj, po obejrzeniu ręcznie dopisanych 3 linii w `pnpm-lock.yaml` i wyniku builda Vercela (Playwright wchodzi jako devDependency produkcyjnej aplikacji; merge do `main` = deploy Timesheeta na produkcję).
- Skrypt blokuje każde żądanie do nielokalnego hosta i pada, jeśli takie wystąpi (aplikacja bierze URL Supabase z `.env.local`, więc dev server wycelowany w scl-dev lub prod zakładałby czynniki w prawdziwej bazie). Tworzy własnych użytkowników `e2e.mfa.{verified,enrolment,pending}@local.test`. („Bramka, której nie było w promptcie, a powinna”.)

## Kontekst
Ten sam błąd `/mfa` („Verifying…” bez końca po poprawnym TOTP) wystąpił **dwa razy**: 1a.25 w `apps/dcs` (17.09, PR #56) i 1a.25b w `apps/timesheet` (20.09, PR #76). Za każdym razem dowód red→green był jednorazowym skryptem Playwrighta ze scratchpada agenta — w repo nie został nic, co złapałoby regresję. W `apps/timesheet` nie ma też testów middleware ani strażników (`guards.test.ts` jest tylko w DCS), więc kryterium „testy przechodzą bez edycji” jest tam spełniane pusto.

Wzorzec do naśladowania: `apps/dcs/e2e/` z 1b.07 (Playwright w repo, poza CI, decyzja odnotowana obok 1a.12 w `docs/03-conventions.md`).

### Zależności
Po merge'u PR #76 (1a.25b). Wzorzec: `apps/dcs/e2e/` z 1b.07. Zależności spełnione: PR #76 (1a.25b) zmergowany 20.09; 1b.07 Done, więc wzorzec `apps/dcs/e2e/` jest na `main`.

*Źródło: odbiór 1a.25b, 20.09.2026 — dwa wystąpienia tego samego błędu, oba dowody poza repo.*

### Rozszerzenie zakresu (decyzja tj, 20.09 wieczorem)
Do zadania wchodzi **także test jednostkowy `safeNextPath`** (vitest, 11 wejść: `https://`, `//`, `/\`, `javascript:`, `data:`, pusty, `undefined`, `null`, liczba, obiekt, kontrola `/admin/projects?x=1#h`). Powód: 1a.26 zostało zamknięte 20.09, ale jego dowód odrzuceń też był uruchomieniem w scratchpadzie — w repo nie ma ani jednego testu na tę funkcję. Oba mechanizmy siedzą w tym samym pliku `apps/timesheet/lib/mfa-navigation.ts`, więc zamykamy je jednym zadaniem.
Dodatkowe kryterium: test jednostkowy pokazany **na czerwono** na celowo zepsutym wariancie funkcji (np. zwracającym wejście bez zmian), nie tylko na zielono.
(Teza o braku testu okazała się fałszywa — patrz sprostowanie w Notatkach z realizacji.)

## Notatki z realizacji
- przed 2026-09-22 (z DCS-1a.25b): poprawka = pełne przeładowanie po `verify` zamiast `router.push(next)` (port 1:1 z PR #56 w `apps/dcs`); bez zmiany zasad bramki aal2 i bez dotykania `next` (1a.26).
- 2026-09-20 (z DCS-1a.25b): PR #76 zmergowany (HEAD `827fdc3`); dowód red→green w trzech trybach był poza repo — stąd 1a.25c.
- 2026-09-20 (z DCS-1a.25b): Preview `seaclouds-management-system` wskazuje na **scl-dev**, nie na prod.
- 2026-09-20 (z DCS-1a.25b): nigdzie — ani dev, ani prod — nie ma konta admin **bez** czynnika TOTP, więc gałęzi enrolment nie da się sprawdzić na Preview bez zdjęcia czynnika; na prodzie jedyne konto z czynnikiem to `ernest.jezionek@seaclouds.eu`.
- 2026-09-20 (z DCS-1a.25b): docelowo ma być jedna strona `/mfa` — `docs/adr/0014-portal-admin.md`.
- przed 2026-09-22 (z DCS-1b.07): strona 1b.07 nie zawiera rozstrzygnięć o `apps/dcs/e2e/` ani o „poza CI” — ta decyzja jest znana tylko z opisu na stronie 1a.25c.
- 2026-09-20 (wieczorem): **Odbiór pierwszej rundy — In Progress, czeka na PR i merge.**
  - **Sprostowanie do rozszerzenia zakresu:** teza „w repo nie ma testu `safeNextPath`” była **fałszywa** — wniosek tj, nie odczyt. `apps/timesheet/lib/mfa-navigation.test.ts` istnieje od `67876ef` (1a.26) i ma 17 przypadków. Agent to wykrył i nie dopisał zbędnego pliku. Z rozszerzenia zostaje czerwony dowód na tych istniejących testach: przy `safeNextPath` zwracającym wejście bez zmian pada 13 z 17.
  - **Zrobione** (gałąź `test/tes-1a25c-mfa-regression`, baza `d379366` = merge #76, nic niezacommitowane):
    - `apps/timesheet/e2e/mfa-navigation.mjs`, uruchamiany przez `pnpm --filter @scl/timesheet e2e:mfa`, wzorem `apps/dcs/e2e/` z 1b.07, poza CI, trzy tryby osobnymi przypadkami.
    - Zielone: 20/20 w trzech przebiegach na `next dev` + jeden na buildzie produkcyjnym; dla każdego trybu `DOCUMENT GET /admin` jako pierwsze żądanie po submit.
    - Czerwone przy zrewertowanej poprawce: na `next dev` 11/20 (`observed RSC GET /admin?_rsc=…`), na buildzie produkcyjnym 8/17 z odtworzeniem samego zawieszenia (`stuck on /mfa — submit button says "Verifying…"`).
    - Kod aplikacji nietknięty (sha256 na `page.tsx`, `mfa-navigation.ts`, `proxy.ts`); `apps/dcs`, `packages/`, `supabase/` bez zmian.
  - **Ustalenie, które zmienia zasadę odbioru:** na `next dev` zrewertowana strona **i tak kończy na `/admin`** — asercja na samym URL-u przeszłaby przy obecnym błędzie. Zawieszenie odtwarza wyłącznie build produkcyjny.
  - **Decyzje tj:** commit + PR, STOP przed merge'em (patrz Bramki STOP); **build produkcyjny jako domyślny tryb** w `docs/03-conventions.md`, dev jako wariant szybki; braki pokrycia (ścieżka roli DC, głębszy `next` niż `/admin`) → wpis w `docs/deferred-tasks.md`.
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3e1c2fbc0595817eae35ff537c8aed7a).
