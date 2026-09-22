---
id: DCS-1b.13
title: "Skrypt importu SMDR → documents/revisions (146 dok.), generator ustawiony na kolejny wolny numer, raport rozbieżności"
status: todo
difficulty: L
model: null
model_approved: null
effort: null
branch: null
due: 2026-09-23
depends_on: [DCS-1a.18, DCS-1a.19, DCS-1b.02, DCS-1b.04]
blocked_by_questions: [O-05]
touches_db: true
touches_prod: false
pr: null
notion: https://app.notion.com/p/3c7c2fbc059581368dd0dd4ee02df205
---

# DCS-1b.13 — Skrypt importu SMDR → documents/revisions (146 dok.), generator ustawiony na kolejny wolny numer, raport rozbieżności

## Cel
Idempotentny skrypt importu SMDR do `dcs.*` z zachowaniem istniejących numerów, po którym generator numeracji kontynuuje od kolejnego wolnego numeru w każdej serii PROJEKT+TYPE, plus raport rozbieżności. Migracja jest testem akceptacyjnym Fazy 1b (brief §13.3).

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)

Kolejność (§13.3):
1. [ ] Słowniki i użytkownicy — wg strony „zrobione w 1a.18 / 1a.19” (patrz Kontekst: 1a.19 ma status To Do)
2. [ ] Projekty z cyklem 7/10/7 — wg strony „zrobione w 1a.19” (j.w.)
3. [ ] Dokumenty z istniejącymi numerami → `dcs.documents`
4. [ ] Rewizje i daty → `dcs.revisions`, `dcs.plan_dates` (daty z arkusza jako Planned/Forecast/Actual per etap, bez przeliczania)
5. [ ] Rejestr wysyłek → `dcs.transmittals` (tabela może być minimalna, pełny moduł w Fazie 3)
6. [ ] Raport rozbieżności: pozycje niezaimportowane z przyczyną

Implementacja:
- [ ] Skrypt w `scripts/import-smdr.ts` (lub Python), wejście: CSV z arkuszy, wyjście: SQL/inserty przez service role + `report.md`
- [ ] **Idempotentny** — uruchamiany wielokrotnie na dev do skutku; klucz naturalny = `scl_doc_number`
- [ ] Trigger generatora numerów wyłączony na czas importu (numer podany jawnie), po imporcie test, że `next_doc_number` daje poprawny kolejny
- [ ] **Kolejność wymuszona przez bazę: dla każdego projektu import musi najpierw założyć wiersz `dcs.mdr_settings`, dopiero potem wstawiać jego dokumenty.** Trigger `documents_mdr_required` (DCS 1b.04, migracja `20260918134211`) odrzuca 23514 każdy dokument na projekcie bez tego wiersza i **nie ma żadnej furtki** — ani `auth.uid() is null`, ani GUC-a `dcs.import_mode`, który otwiera wyłącznie `scl_doc_number`. To jest decyzja świadoma i **zostaje**: brak wiersza znaczy „DCS nie prowadzi tego projektu”, a to fakt o konfiguracji projektu, nie reguła autoryzacyjna, więc `service_role` i `postgres` też są odrzucane.
- [ ] Mapowanie kolorów → status wg decyzji O-05; nieznane wartości → do raportu
- [ ] Dokumenty bez dat/rewizji → status `Not started` (§13.2)
- [ ] Format siedmiopolowy z Transmittals → rozparsować na pięciopolowy
- [ ] **Pliki nie są importowane** — dołączane ręcznie po migracji (§13.3)

## Gotowe, gdy
- Import na dev przechodzi bez błędów — **jak sprawdzić**: TODO
- Liczba dokumentów = 146 minus pozycje w raporcie — **jak sprawdzić**: TODO
- Raport gotowy do przejścia z DC — **jak sprawdzić**: TODO

## Poza zakresem
- Import plików (dołączane ręcznie po migracji, §13.3).
- Pełny moduł transmittali (Faza 3).

## Bramki STOP
- **Nie dokładać `import_mode` do triggera `documents_mdr_required`** — jeśli kolejność „najpierw `dcs.mdr_settings`, potem dokumenty” okaże się niewykonalna, wraca jako osobna decyzja, nie jako obejście w skrypcie.

## Kontekst
Brief (§13.3): migracja jest testem akceptacyjnym Fazy 1b. Import z zachowaniem istniejących numerów; generator numeracji musi po imporcie kontynuować od kolejnego wolnego numeru w każdej serii PROJEKT+TYPE (dlatego 1b.02 liczy max z tabeli, a nie z sekwencji).

- O-05 (mapowanie kolorów kolumny E na `workflow_status`) otwarte — import stosuje mapowanie „wg decyzji O-05”.
- Uwaga importu: strona podaje kroki 1–2 jako „zrobione w 1a.18 / 1a.19”, ale DCS-1a.19 ma w Notion status To Do.
- Uwaga importu: `depends_on` obejmuje 1b.02 i 1b.04, bo strona wprost opiera się na ich mechanizmach (liczenie max z tabeli, trigger `documents_mdr_required`).

## Notatki z realizacji
- 2026-09-21 (z DCS-1b.10): blokada rewizji finalnych (`revisions.locked_at`) respektuje furtkę `dcs.import_mode` (poza DELETE) — import historycznych rewizji finalnych idzie przez tę furtkę, nie przez obejście triggera.
- przed 2026-09-22 (z DCS-1a.18): słowniki startowe pochodzą z briefu (zał. A i B), nie z arkusza Legend — rozszerzona lista z Legend nigdy nie była używana i jest przycięta do 23 kodów `doc_type` z procedury (§13.2, D-03).
- przed 2026-09-22 (z DCS-1a.18): `workflow_status` w słowniku: Not started, Started, IDC, IFR, RETCOM, IFC/IFI/IFB, Void; `workflow_step`: IDC, IFR, RETCOM, IFC, IFI, IFB.
- przed 2026-09-22 (z DCS-1b.02): `dcs.next_doc_number(project_id, doc_type, lang, orig default 'SCL')` — `pg_advisory_xact_lock` per projekt+typ, `max(seq)` po istniejących dokumentach (łącznie z Void) + 1; wołana z triggera BEFORE INSERT, gdy `scl_doc_number IS NULL`; trigger BEFORE UPDATE odrzuca zmianę `scl_doc_number`. Liczenie z tabeli, nie z sekwencji, właśnie po to, by po migracji generator „wiedział” o istniejących numerach.
- przed 2026-09-22 (z DCS-1b.04): nowy dokument ma status `Not started`, bez rewizji; kod CTR z `sub_projects` danego projektu (D-24).
- 2026-09-22: zaimportowane z Notion (https://app.notion.com/p/3c7c2fbc059581368dd0dd4ee02df205).
