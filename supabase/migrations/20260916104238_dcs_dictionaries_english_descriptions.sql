-- Follow-up to DCS 1a.18: rewrite the seeded `description` texts in English.
--
-- Two defects found reviewing the 1a.15 screen after 1a.18 landed:
--   1. the 23 `doc_type` descriptions were seeded as the Polish gloss from
--      the brief, while `label` and every other string the DC sees is
--      English — the column reads as a stray untranslated field;
--   2. `acceptance_code` 3 leaked a repository path into user-facing data
--      ("… (docs/00-glossary.md: powrót do Originatora)"). A DC has no
--      `docs/` tree; the rule itself is what belongs there.
-- The replacement texts are DC's, approved verbatim — this migration does
-- not reword them.
--
-- Data, not structure, so the same reasoning as 1a.18 applies: it belongs in
-- a migration and not in `supabase/seed.sql`, because `supabase db push`
-- never runs the seed and these registers exist on every environment.
--
-- Guarded, one statement per row: each UPDATE matches on the *exact* text
-- 1a.18 seeded, so a row a DC has since edited through the 1a.15 screen
-- updates zero rows instead of being overwritten. That is the UPDATE-shaped
-- version of 1a.18's `on conflict do nothing`, and for the same reason —
-- from the first apply on, the dictionaries are the DC's to manage (brief
-- §5.8), not the repository's. The cost is that this file is single-use: on
-- an environment where a text has already drifted it silently does less, so
-- the row count it reports is the thing to read, not the exit code.
--
-- Expected: 24 rows on every environment — 23 doc_type plus acceptance_code
-- 3, which carries two alternative guards (see its note below) because the
-- row was already hand-edited on scl-dev. Exactly one of the two fires.

-- ------------------------------------------------------------------
-- doc_type — 23 rows. Same order as 1a.18 (alphabetical by code);
-- `label` and `meta.budget_hours` are untouched, only the gloss changes.
-- ------------------------------------------------------------------
update dcs.dictionaries set description = 'Budgeting, cost estimating, commercial pricing'
 where dict_type = 'doc_type' and code = 'AA'
   and description = 'Budżetowanie, kosztorysowanie, wycena handlowa';

update dcs.dictionaries set description = 'Methodology, assumptions, input data and interpretation of results'
 where dict_type = 'doc_type' and code = 'AS'
   and description = 'Metodyka, założenia, dane wejściowe i interpretacja wyników';

update dcs.dictionaries set description = 'List of items, tasks or activities to be completed'
 where dict_type = 'doc_type' and code = 'CL'
   and description = 'Lista pozycji, zadań lub czynności do wykonania';

update dcs.dictionaries set description = 'Structured set of design documentation'
 where dict_type = 'doc_type' and code = 'DP'
   and description = 'Uporządkowany zestaw dokumentacji projektowej';

update dcs.dictionaries set description = 'Guidance supporting the application of a procedure or standard'
 where dict_type = 'doc_type' and code = 'GD'
   and description = 'Wytyczne wspierające stosowanie procedury lub normy';

update dcs.dictionaries set description = 'Scope of duties for a position'
 where dict_type = 'doc_type' and code = 'JD'
   and description = 'Zakres obowiązków stanowiska';

update dcs.dictionaries set description = 'Tasks, methods and operations described in detail'
 where dict_type = 'doc_type' and code = 'KA'
   and description = 'Zadania, metody i operacje opisane szczegółowo';

update dcs.dictionaries set description = 'Quality and HSE system documentation, plans, risk assessments, HAZOP / HIRA'
 where dict_type = 'doc_type' and code = 'KQ'
   and description = 'Dokumentacja systemu jakości i HSE, plany, oceny ryzyka, HAZOP / HIRA';

update dcs.dictionaries set description = 'Process standardisation, recording of project information'
 where dict_type = 'doc_type' and code = 'LA'
   and description = 'Standaryzacja procesów, rejestrowanie informacji projektowych';

update dcs.dictionaries set description = 'Recording and handling of deviations from requirements'
 where dict_type = 'doc_type' and code = 'NC'
   and description = 'Rejestracja i obsługa odstępstw od wymagań';

update dcs.dictionaries set description = 'Organisational structure'
 where dict_type = 'doc_type' and code = 'OC'
   and description = 'Struktura organizacyjna';

update dcs.dictionaries set description = 'Commercial offer, proposal, tender materials including CVs'
 where dict_type = 'doc_type' and code = 'OF'
   and description = 'Oferta handlowa, propozycja, materiały przetargowe wraz z CV';

update dcs.dictionaries set description = 'Company-level principle, commitment or rule'
 where dict_type = 'doc_type' and code = 'PO'
   and description = 'Zasada, zobowiązanie lub reguła na poziomie firmy';

update dcs.dictionaries set description = 'Presentation for meetings, training, project activities'
 where dict_type = 'doc_type' and code = 'PR'
   and description = 'Prezentacja na spotkania, szkolenia, działania projektowe';

update dcs.dictionaries set description = 'Results, conclusions and summary after completion of work'
 where dict_type = 'doc_type' and code = 'RA'
   and description = 'Wyniki, wnioski i podsumowanie po zakończeniu prac';

update dcs.dictionaries set description = 'Technical requirements for equipment and services'
 where dict_type = 'doc_type' and code = 'SA'
   and description = 'Wymagania techniczne dla urządzeń i usług';

update dcs.dictionaries set description = 'Short document recording technical clarifications'
 where dict_type = 'doc_type' and code = 'TN'
   and description = 'Krótki dokument rejestrujący wyjaśnienia techniczne';

update dcs.dictionaries set description = 'Technical and operational queries during a project or supervision'
 where dict_type = 'doc_type' and code = 'TQ'
   and description = 'Zapytania techniczne i operacyjne w trakcie projektu lub nadzoru';

update dcs.dictionaries set description = 'General arrangement drawing'
 where dict_type = 'doc_type' and code = 'XD'
   and description = 'Rysunek zestawieniowy';

update dcs.dictionaries set description = 'Arrangement drawing of equipment, site or works'
 where dict_type = 'doc_type' and code = 'XE'
   and description = 'Rysunek rozmieszczenia urządzeń, terenu lub prac';

update dcs.dictionaries set description = 'Drawing of route and corridor alignments'
 where dict_type = 'doc_type' and code = 'XW'
   and description = 'Rysunek przebiegu tras i korytarzy';

update dcs.dictionaries set description = 'Drawing not covered by the other codes'
 where dict_type = 'doc_type' and code = 'XX'
   and description = 'Rysunek nieobjęty pozostałymi kodami';

update dcs.dictionaries set description = 'Map presenting survey results'
 where dict_type = 'doc_type' and code = 'XZ'
   and description = 'Mapa prezentująca wyniki pomiarów';

-- ------------------------------------------------------------------
-- acceptance_code 3 — the mandatory-comment rule, stated without the
-- repository path. It still lives in `description` rather than `meta`:
-- no `comment_required` key is defined yet (1a.18 header note, O-05 and
-- docs/deferred-tasks.md r), and inventing one here would be a shape the
-- app does not read.
-- ------------------------------------------------------------------
update dcs.dictionaries set description = 'Comment mandatory — document returns to the Originator.'
 where dict_type = 'acceptance_code' and code = '3'
   and description = 'A comment is mandatory for this code (docs/00-glossary.md: powrót do Originatora).';

-- Second guard for the same row. On scl-dev the seeded text is already gone:
-- DC trimmed the docs/ path by hand on the 1a.15 screen on 2026-09-16
-- 10:35:59Z (public.audit_log), leaving 'A comment is mandatory for this
-- code'. That edit is a partial version of this very correction, not
-- independent dictionary content, so DC approved converging it on the text
-- above rather than letting the two environments drift apart. Matched on the
-- exact value, like every other statement here — an unexpected third wording
-- still updates nothing. The two statements never both fire on one row: the
-- first leaves the new text, which this WHERE does not match.
update dcs.dictionaries set description = 'Comment mandatory — document returns to the Originator.'
 where dict_type = 'acceptance_code' and code = '3'
   and description = 'A comment is mandatory for this code';
