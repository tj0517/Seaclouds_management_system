---
id: DCS-1b.11
title: "Ręczna zmiana statusu dokumentu przez DC + Void dokumentu (Faza 1: bez silnika obiegu)"
status: in_progress
difficulty: S
model: null
model_approved: null
effort: null
branch: feat/manual-status-void
due: 2026-09-23
depends_on: [DCS-1b.10, DCS-1b.02]
blocked_by_questions: []
touches_db: true
touches_prod: false
pr: 84
notion: https://app.notion.com/p/3c7c2fbc059581a5ac06e0c412ac0592
---

# DCS-1b.11 — Ręczna zmiana statusu dokumentu przez DC + Void dokumentu (Faza 1: bez silnika obiegu)

## Cel
Umożliwić DC ręczne ustawianie statusu dokumentu i rewizji oraz Void dokumentu, tak jak dziś w arkuszu — żeby system był używalny po Fazie 1, a Excel mógł zostać wyłączony, zanim przyjdzie silnik obiegu (Faza 2).

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] W profilu dokumentu: dropdown statusu (`workflow_status`: Not started / Started / IDC / IFR / RETCOM / IFC-IFI-IFB / Void) widoczny dla DC
- [ ] Status rewizji (Draft / In Review / Approved / Rejected / Superseded / Void) — analogicznie
- [ ] Zmiana statusu → audit log; ustawienie `Approved` na rewizji finalnej uruchamia blokadę z 1b.10 (uwaga: patrz Notatki z realizacji — w schemacie blokadą jest `locked_at`, nie status `Approved`)
- [ ] **Void dokumentu**: osobna akcja z potwierdzeniem i obowiązkowym powodem; numer nie wraca do puli (1b.02); dokument zostaje w rejestrze oznaczony jako Void
- [ ] Oznaczenie w UI, że statusy są „manual” — w Fazie 2 dropdown zostanie zastąpiony przez wynik obiegu

## Gotowe, gdy
- DC przeprowadza dokument ręcznie przez wszystkie statusy — **jak sprawdzić**: TODO
- Void działa i jest w audit logu — **jak sprawdzić**: TODO

## Poza zakresem
Silnik obiegu (approval_tasks, IDC/IFR) — Faza 2.

## Bramki STOP
—

## Kontekst
Silnik obiegu (approval_tasks, IDC/IFR) to Faza 2. Żeby system był używalny po Fazie 1 — a Excel mógł zostać wyłączony — DC musi móc ręcznie ustawić status dokumentu i rewizji, tak jak dziś robi to w arkuszu. Brief (§7.3) i tak mówi, że tylko DC zmienia status w MDR.

- Uwaga importu: `depends_on` ustawione na 1b.10 i 1b.02, bo strona wprost opiera się na ich wyniku („uruchamia blokadę z 1b.10”, „numer nie wraca do puli (1b.02)”); obie Done.

## Notatki z realizacji
- 2026-09-21 (z DCS-1b.10): „Approved” nie istnieje w schemacie → zatwierdzenie = nowa kolumna `dcs.revisions.locked_at` (ustawia DC z aal2; tylko IFC/IFI/IFB; odblokowania brak).
- 2026-09-21 (z DCS-1b.10): zablokowana rewizja — pliki bez INSERT/UPDATE/DELETE; rewizja tylko → SUPERSEDED, gdy istnieje nowsza (`created_at`).
- 2026-09-21 (z DCS-1b.10): UI ustawiania blokady przekazane do 1b.11 („W Fazie 1 »zatwierdzenie« ustawia ręcznie DC (1b.11) — silnik obiegu w Fazie 2 będzie ustawiał to samo pole”).
- 2026-09-21 (z DCS-1b.10): import omija blokadę przez `dcs.import_mode`; test współbieżności odłożony (deferred (ddd)).
- przed 2026-09-22 (z DCS-1b.02): luki nie są uzupełniane — numer Void nigdy nie wraca; SEQ = max łącznie z Void, +1; numer niezmienny (trigger BEFORE UPDATE odrzuca zmianę `scl_doc_number`); błędny dokument → Void + nowy numer.
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc059581a5ac06e0c412ac0592).
- 2026-09-22: PR #84 (migracja + testy, część 1 z 2) zmergowany; migracja 20260922074250 na scl-dev; na prod wdraża tj ręcznie; część 2 (UI) — gałąź feat/manual-status-void-ui.
- 2026-09-22 (z DCS-1b.09b): `e2e:revision` pada w setupie na main — `new-revision.mjs:171` wstawia dokument VOID bez `void_reason`, co od migracji 20260922074250 (7a5050c) odrzuca baza; poprawka należy do PR-a UI (feat/manual-status-void-ui), `docs/deferred-tasks.md` ggg.
