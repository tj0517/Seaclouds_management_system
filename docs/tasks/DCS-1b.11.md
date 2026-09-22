---
id: DCS-1b.11
title: "Ręczna zmiana statusu dokumentu przez DC + Void dokumentu (Faza 1: bez silnika obiegu)"
status: done
difficulty: S
model: Sonnet
model_approved: tj
effort: medium
branch: feat/manual-status-void-ui
due: 2026-09-23
depends_on: [DCS-1b.10, DCS-1b.02]
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 89
notion: https://app.notion.com/p/3c7c2fbc059581a5ac06e0c412ac0592
---

# DCS-1b.11 — Ręczna zmiana statusu dokumentu przez DC + Void dokumentu (Faza 1: bez silnika obiegu)

## Cel
Umożliwić DC ręczne ustawianie statusu dokumentu i rewizji oraz Void dokumentu, tak jak dziś w arkuszu — żeby system był używalny po Fazie 1, a Excel mógł zostać wyłączony, zanim przyjdzie silnik obiegu (Faza 2).

## Zakres
- [ ] Odczyt stanu bieżącego (dodane przy imporcie)
- [ ] W profilu dokumentu: dropdown statusu (`workflow_status`: Not started / Started / IDC / IFR / RETCOM / IFC-IFI-IFB / Void) widoczny dla DC *(zbudowane bez Void — Void to osobna akcja, patrz punkt niżej i Notatki 2026-09-22)*
- [ ] Status rewizji — analogicznie *(kody z tego samego słownika co krok — IDC/IFR/RETCOM/IFC/IFI/IFB — a nie „Draft/In Review/Approved/Rejected/Superseded/Void" z pierwotnego opisu; ten zestaw nigdy nie istniał w schemacie. Patrz Notatki 2026-09-22.)*
- [ ] Zmiana statusu → audit log; ustawienie `Approved` na rewizji finalnej uruchamia blokadę z 1b.10 (uwaga: patrz Notatki z realizacji — w schemacie blokadą jest `locked_at`, nie status `Approved`)
- [ ] **Void dokumentu**: osobna akcja z potwierdzeniem i obowiązkowym powodem; numer nie wraca do puli (1b.02); dokument zostaje w rejestrze oznaczony jako Void
- [ ] Oznaczenie w UI, że statusy są „manual” — w Fazie 2 dropdown zostanie zastąpiony przez wynik obiegu

## Gotowe, gdy
*(Kryteria dopisane 2026-09-22, po review — pierwotnie TODO.)*
- **DC przeprowadza dokument ręcznie przez wszystkie statusy** (`NOT_STARTED → STARTED → IDC → IFR → RETCOM → IFC`) — **jak sprawdzić**: `e2e:status` (`apps/dcs/e2e/manual-status.mjs`), sekcja `a`; każdy krok potwierdzony odczytem `workflow_status_id` z bazy, nie tylko wyglądem strony.
- **Status bieżącej rewizji da się zmienić przez DC** — **jak sprawdzić**: `e2e:status` sekcja `c` (`c/DB` asercje na `dcs.revisions.status_id`); `lib/revisions.test.ts` (`revisionStatusAccess`, `setRevisionStatus`).
- **Zmiana statusu (dokumentu i rewizji) trafia do `public.audit_log`, z powodem przy Void** — **jak sprawdzić**: `e2e:status`, blok „audit: public.audit_log carries the void_reason row"; surowe wiersze `occurred_at|field_name|old_value|new_value` drukowane przy każdym uruchomieniu.
- **Approve blokuje rewizję finalną (`locked_at`, ponowne użycie blokady z 1b.10), nie odblokowuje się nigdy** — **jak sprawdzić**: `e2e:status` sekcja `c`; `lib/revisions.test.ts` (`lockRevisionAccess`, `lockRevision`); `fileUploadAccess()` w `lib/files.ts` odmawia Add File na zablokowanej rewizji (znalezione i naprawione przy weryfikacji ręcznej — Approve dopiero uczynił ten stan osiągalnym z UI).
- **Void: osobna akcja z potwierdzeniem i obowiązkowym powodem; numer nie wraca do puli (1b.02, niezmienione)** — **jak sprawdzić**: `e2e:status` sekcja `d`; dowód RED (a) — Void z pustym powodem wprost przez PostgREST jako DC na aal2, odrzucone 23514, z ominięciem dialogu.
- **Oznaczenie w UI, że statusy są manual** — **jak sprawdzić**: `e2e:status` sekcja `a` (asercja tekstu „Manual — in Phase 2…"); `DocumentStatusControl.tsx`, `RevisionStatusControl.tsx`.
- **Czytelnik spoza DC (i spoza admina, dla Void/Approve) nie widzi kontrolki statusu/Void/Approve w ogóle — nie tylko wyłączonej** — **jak sprawdzić**: `e2e:status` sekcja `b`, w tym przypadek, w którym stan formalnie pozwoliłby DC-owi na Approve (rewizja na kroku finalnym, niezablokowana), a mimo to nie-DC nie widzi przycisku.
- **Na dokumencie Void żaden czytelnik, także admin, nie widzi kontrolki statusu w UI — wyjście z Void zostaje wyłącznie faktem bazodanowym (decyzja tj, 2026-09-22)** — **jak sprawdzić**: `e2e:status` sekcje `d` i `e`.
- **Brak regresji na `e2e:profile` i `e2e:revision`** — **jak sprawdzić**: oba 40/40 na świeżym `db reset` + fixturze, logi w opisie PR-a.

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
- 2026-09-22 (review, tj): pierwotny opis Zakresu („Status rewizji: Draft / In Review / Approved / Rejected / Superseded / Void") nie odpowiada schematowi — te kody nigdy nie istniały w `workflow_status`. Zbudowano DC-only kontrolkę statusu na bieżącej rewizji z tego samego słownika co krok (`REVISION_STATUS_CODES` w `lib/revisions.ts`: IDC/IFR/RETCOM/IFC/IFI/IFB), zamrożoną po Approve (`forbid_change_of_locked_revision`, 1b.10). Kontrolkę dodano po liście braków z review, która nie znała wcześniejszej decyzji; tj 2026-09-22 świadomie potwierdził: kontrolka zostaje.
- 2026-09-22 (tj): na dokumencie Void w UI nie ma kontrolki statusu dla nikogo, także admina; wyjście z Void zostaje tylko w bazie (admin, aal2) — decyzja o Un-Void dalej w deferred (eee). Zaimplementowane: `DocumentInformationTab.tsx` nie renderuje `DocumentStatusControl` ani przycisku Void, gdy `document.workflow_status.code === 'VOID'`, niezależnie od roli; `documentStatusAccess()` w `lib/documents.ts` nadal poprawnie zwraca `enabled` dla admina na aal2 w tym stanie (wierne odbicie bazy), ale nic w UI tego nie używa.
- 2026-09-22 (review, tj): czytelnik spoza DC (i spoza admina, dla Void/Approve) nie widzi kontrolki statusu/Void/Approve w ogóle — nie tylko wyłączonej z podpisem, jak New Revision/Add File. Zaimplementowane w `DocumentInformationTab.tsx` i `RevisionPanelActions.tsx`; `ApproveControl` niesie osobne pole `eligible` (= isDc), bo `lockRevisionAccess` sprawdza blokadę i krok finalny PRZED rolą, więc sam powód odmowy nie odróżnia „nie-DC" od „DC, ale zły krok".
- 2026-09-22: dodano `e2e:status` (`apps/dcs/e2e/manual-status.mjs`) — drabinka statusu, status rewizji, Approve, Void, dwa dowody RED wprost przez PostgREST, wszystko potwierdzone odczytem z bazy. `docs/03-conventions.md` (szósty skrypt e2e).
- 2026-09-22 (review, tj): kontrolka statusu rewizji pozwala DC ustawić `status_id` niezależnie od `step_id` — baza na to pozwala, nic tego nie uzgadnia aż do silnika obiegu w Fazie 2. Odnotowane, nie naprawione: `docs/deferred-tasks.md` (hhh).
- 2026-09-22 (tj): odbiór — przyjęte; merge dopiero po wdrożeniu migracji 20260922074250 na prod.
- 2026-09-22: odbiór części 2 (UI) — PR w przygotowaniu (`feat/manual-status-void-ui`). `e2e:profile` i `e2e:revision` bez regresji (40/40 każdy). Migracja 20260922074250 (PR #84, część 1) NIE jest jeszcze zastosowana na prod (odczyt `supabase-prod` MCP, `list_migrations`, 2026-09-22 — ostatnia widoczna to `20260921150000_lock_final_revisions`); zgodnie z CLAUDE.md, prod dostaje ją ręcznie od tj.
