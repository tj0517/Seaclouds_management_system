---
id: DCS-1b.20
title: "Tabela dokumentów projektu: pełne nazwy typu, dyscypliny i obszaru"
status: review
kind: code             # code | client | ops | milestone
difficulty: S
model: Sonnet
model_approved: null
effort: low
branch: feat/project-documents-dictionary-labels
due: null
depends_on: []
blocked_by_questions: []
touches_db: false
touches_prod: false
pr: 93
---

# DCS-1b.20 — Tabela dokumentów projektu: pełne nazwy typu, dyscypliny i obszaru

## Cel
Tabela dokumentów projektu pokazuje dziś same kody (XD, ME, A01), które nic nie mówią osobie spoza Document Control. Kolumny mają pokazywać „kod — nazwa”.

## Zakres
- [x] Odczyt stanu bieżącego: `app/(app)/projects/[projectId]/documents/page.tsx`, pomocnik `dictionaryLabel` w `lib/document-profile.ts`
- [x] Kolumny Type, Discipline, Area (i Lang dla spójności) jako „kod — nazwa”, bez rozjeżdżania tabeli (skracanie z pełną nazwą w podpowiedzi)

## Gotowe, gdy
- kolumny pokazują „kod — nazwa” — **jak sprawdzić**: dowód przeglądarkowy na Preview (scl-dev)
- dokument wskazujący na nieaktywny wpis słownika nadal się wyświetla — **jak sprawdzić**: dezaktywacja wpisu na scl-dev + zrzut

## Poza zakresem
- rejestr MDR `/mdr` (ma własny układ kolumn z zał. C)

## Bramki STOP
—

## Kontekst
- `CLAUDE.md`, `docs/03-conventions.md`

## Notatki z realizacji
- 2026-09-23 tj: Uwagi z prezentacji Fazy 1 dla klienta, tj 2026-09-23.
- 2026-09-24 tj: kryterium „nieaktywny wpis” dowodzone lokalnie (bez zapisu na scl-dev); „kod — nazwa” na Preview sprawdza tj przy odbiorze.
- 2026-09-24: zaimplementowane — `page.tsx` (kolumny Type/Discipline/Area/Lang) renderuje `dictionaryLabel(...)` z `apps/dcs/lib/document-profile.ts` zamiast surowego `.code`; brak drugiego formattera, brak zmiany w `listProjectDocuments` (już selectowała `label`). Skracanie: `span` z `truncate max-w-[16rem]` (Type/Discipline/Area) / `max-w-[10rem]` (Lang) + `title` z pełnym „kod — nazwa”, ten sam mechanizm co `RevisionsTab`. `pnpm typecheck`/`lint`/`test:unit` czyste, 605/605 (testy `dictionaryLabel` bez zmian). Bez nowego pomocnika — nic do dopisania w vitest.
  - Dowód lokalny (localhost:3001, Playwright MCP, konto `tjezionekspam@gmail.com` — jedyne z dostępem do modułu `dcs` w fixturze): projekt SC2602 (`6c0909ce-9b74-4bda-8e92-10811ff5a0fc`), dokument `SC2602-SCL-RA-0002-EN`.
  - Krótkie wartości: „RA — Report”, „A00 — Administration”, „00 — General”, „EN — English” — `sc2602-documents-table.png`.
  - Długa wartość (49 znaków, wpis `doc_type` „AS” z fixtury, `id d6ade2d1-f7f1-4260-9650-de8d7c16b92b`): tymczasowo `update dcs.documents set doc_type_id = 'd6ade2d1-...' where id = 'f3000000-...-0002'` na LOKALNEJ bazie → komórka pokazuje obcięty tekst z `…`, DOM: `scrollWidth 384 > clientWidth 256` (realne obcięcie), `title` niesie pełny tekst „AS — Analysis, Studies, Strategies, Assessments, Tests” — `sc2602-documents-truncated-long-type.png`.
  - Nieaktywny wpis: `update dcs.dictionaries set is_active = false where id = 'd6ade2d1-...'` returning `is_active = f` na LOKALNEJ bazie → przeładowanie, wiersz nadal pokazuje „AS — Analysis, Studies, Strategies, Assessments, Tests” — `sc2602-documents-inactive-entry-row.png`.
  - Pusty stan bez zmian (projekt SCMS-IT, 0 dokumentów) — `scms-it-documents-empty-state.png`.
  - Oba zapisy odwrócone po dowodzie: `is_active` z powrotem `true`, `doc_type_id` z powrotem na oryginalny „RA” wpis; potwierdzone odczytem `select d.scl_doc_number, dt.code, dt.label from dcs.documents d join dcs.dictionaries dt on dt.id = d.doc_type_id where d.project_id = '6c0909ce-...'` → oba wiersze „RA / Report”. Żadnego zapisu na scl-dev ani prod.
  - Zrzuty w `.playwright-mcp/1b20-after-fix/` (gitignored, nie w tym PR).
  - `status: review`, `pr: 93` ustawione w tym pliku i w INDEX. Nie scalone — PR czeka na tj.
