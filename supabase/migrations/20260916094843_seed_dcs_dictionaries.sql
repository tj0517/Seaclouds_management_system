-- DCS 1a.18: seed the seven DCS dictionaries from the developer brief
-- (attachments A and B, §7.4). 1a.07 created dcs.dictionaries deliberately
-- empty and named this task as the one that fills it; the 1a.15 admin screen
-- has had nothing to show since.
--
-- Source of the values: the brief, NOT the "Legend" sheet of SCL_SMDR_v4.xlsx.
-- Brief §13.2 (D-03) records that the extended Legend list was never actually
-- used and is trimmed to the 23 procedure codes seeded here. Likewise the
-- discipline list is the brief's table B.2 (29 entries), not the 32 the
-- planning note quotes — DC confirms the count separately.
--
-- Data, not structure — but it still belongs in a migration, not in
-- supabase/seed.sql: seed.sql runs only on the local stack and in CI and is
-- explicitly NOT executed by `supabase db push` (docs/03-conventions.md), and
-- these registers must exist on every environment, prod included.
--
-- Idempotent and forward-only: every statement is
-- `insert ... on conflict (dict_type, code) do nothing`, so re-running the
-- file inserts nothing and — importantly — never rewrites a row a DC has
-- since edited through the 1a.15 screen. That is the deliberate trade-off of
-- DO NOTHING over DO UPDATE: divergence from this file is allowed after the
-- first apply, because from here on the dictionaries are the DC's to manage
-- (brief §5.8), not the repository's. Same reason no row is deleted or
-- deactivated here: scl-dev's pre-existing `doc_type/TST` row stays exactly
-- as it is (inactive, sort_order 0).
--
-- meta: the only key with a defined meaning is `budget_hours`, on `doc_type`
-- only (docs/02-data-model.md; readBudgetHours / createDictionaryEntry in
-- apps/dcs/lib/dictionaries-admin.ts, which rejects it on any other type).
-- Every other dictionary is seeded with meta = '{}' rather than inventing a
-- key the app would not read — notably acceptance code 3, whose "a comment is
-- mandatory" rule goes into `description`, since no `comment_required` key is
-- defined anywhere yet. A `colour` key for workflow_status is still O-05.
--
-- sort_order starts at 10 and steps by 10 — room to insert between entries
-- later, and above the 0 that `TST` (and the column default) uses, so a
-- seeded row never ties with a hand-made one. The 1a.15 screen and
-- getActiveDictionary() both order by (sort_order, code).

-- ------------------------------------------------------------------
-- doc_type — brief attachment A, 23 procedure codes. label = the brief's
-- English definition, description = its Polish gloss, meta.budget_hours =
-- the default budget a document of this type inherits (docs/02-data-model.md:
-- dcs.documents.budget_hours "default z typu dokumentu"). sort_order is
-- alphabetical by code; the budget is NOT the sort key.
-- ------------------------------------------------------------------
insert into dcs.dictionaries (dict_type, code, label, description, meta, sort_order, is_active) values
  ('doc_type', 'AA', 'Accounting / Budget',                            'Budżetowanie, kosztorysowanie, wycena handlowa',                              '{"budget_hours": 20}'::jsonb,  10, true),
  ('doc_type', 'AS', 'Analysis, Studies, Strategies, Assessments, Tests', 'Metodyka, założenia, dane wejściowe i interpretacja wyników',                '{"budget_hours": 60}'::jsonb,  20, true),
  ('doc_type', 'CL', 'Checklist',                                      'Lista pozycji, zadań lub czynności do wykonania',                              '{"budget_hours": 16}'::jsonb,  30, true),
  ('doc_type', 'DP', 'Design package',                                 'Uporządkowany zestaw dokumentacji projektowej',                                '{"budget_hours": 80}'::jsonb,  40, true),
  ('doc_type', 'GD', 'Guidance Document',                              'Wytyczne wspierające stosowanie procedury lub normy',                          '{"budget_hours": 24}'::jsonb,  50, true),
  ('doc_type', 'JD', 'Job Description',                                'Zakres obowiązków stanowiska',                                                 '{"budget_hours": 16}'::jsonb,  60, true),
  ('doc_type', 'KA', 'Procedure and Manual',                           'Zadania, metody i operacje opisane szczegółowo',                               '{"budget_hours": 40}'::jsonb,  70, true),
  ('doc_type', 'KQ', 'Quality and HSE Document',                       'Dokumentacja systemu jakości i HSE, plany, oceny ryzyka, HAZOP / HIRA',        '{"budget_hours": 40}'::jsonb,  80, true),
  ('doc_type', 'LA', 'List, Form and Register',                        'Standaryzacja procesów, rejestrowanie informacji projektowych',                '{"budget_hours": 16}'::jsonb,  90, true),
  ('doc_type', 'NC', 'Non-conformance report',                         'Rejestracja i obsługa odstępstw od wymagań',                                   '{"budget_hours": 16}'::jsonb, 100, true),
  ('doc_type', 'OC', 'Organization Chart',                             'Struktura organizacyjna',                                                      '{"budget_hours": 16}'::jsonb, 110, true),
  ('doc_type', 'OF', 'Offer, Proposal',                                'Oferta handlowa, propozycja, materiały przetargowe wraz z CV',                 '{"budget_hours": 40}'::jsonb, 120, true),
  ('doc_type', 'PO', 'Policy',                                         'Zasada, zobowiązanie lub reguła na poziomie firmy',                            '{"budget_hours": 16}'::jsonb, 130, true),
  ('doc_type', 'PR', 'Presentation',                                   'Prezentacja na spotkania, szkolenia, działania projektowe',                    '{"budget_hours": 16}'::jsonb, 140, true),
  ('doc_type', 'RA', 'Report',                                         'Wyniki, wnioski i podsumowanie po zakończeniu prac',                           '{"budget_hours": 60}'::jsonb, 150, true),
  ('doc_type', 'SA', 'Specification',                                  'Wymagania techniczne dla urządzeń i usług',                                    '{"budget_hours": 40}'::jsonb, 160, true),
  ('doc_type', 'TN', 'Technical Note',                                 'Krótki dokument rejestrujący wyjaśnienia techniczne',                          '{"budget_hours": 16}'::jsonb, 170, true),
  ('doc_type', 'TQ', 'Technical Query',                                'Zapytania techniczne i operacyjne w trakcie projektu lub nadzoru',             '{"budget_hours": 16}'::jsonb, 180, true),
  ('doc_type', 'XD', 'GA Drawing',                                     'Rysunek zestawieniowy',                                                        '{"budget_hours": 80}'::jsonb, 190, true),
  ('doc_type', 'XE', 'Layout Drawing',                                 'Rysunek rozmieszczenia urządzeń, terenu lub prac',                             '{"budget_hours": 80}'::jsonb, 200, true),
  ('doc_type', 'XW', 'Alignment Sheets Drawing',                       'Rysunek przebiegu tras i korytarzy',                                           '{"budget_hours": 80}'::jsonb, 210, true),
  ('doc_type', 'XX', 'Miscellaneous Drawing',                          'Rysunek nieobjęty pozostałymi kodami',                                         '{"budget_hours": 40}'::jsonb, 220, true),
  ('doc_type', 'XZ', 'Survey Map Drawing',                             'Mapa prezentująca wyniki pomiarów',                                            '{"budget_hours": 80}'::jsonb, 230, true)
on conflict (dict_type, code) do nothing;

-- ------------------------------------------------------------------
-- area — brief attachment B. The code is a numeric string, not an integer:
-- `code` is text and becomes a segment of document numbering, so leading
-- zeros matter ('00', not 0).
-- ------------------------------------------------------------------
insert into dcs.dictionaries (dict_type, code, label, sort_order, is_active) values
  ('area', '00', 'General',   10, true),
  ('area', '10', 'Offshore',  20, true),
  ('area', '20', 'Nearshore', 30, true),
  ('area', '30', 'Onshore',   40, true)
on conflict (dict_type, code) do nothing;

-- ------------------------------------------------------------------
-- discipline — brief attachment B, table B.2: 29 entries, in the brief's own
-- order (which is alphabetical by code). W00–W04 subdivide Survey and X00/X01
-- Data Management; the two-level codes are the brief's, not a convention
-- invented here.
-- ------------------------------------------------------------------
insert into dcs.dictionaries (dict_type, code, label, sort_order, is_active) values
  ('discipline', 'A00', 'Administration',          10, true),
  ('discipline', 'B00', 'Procurement & SCM',        20, true),
  ('discipline', 'C00', 'Sales & Marketing',        30, true),
  ('discipline', 'D00', 'Project Control',          40, true),
  ('discipline', 'E00', 'Human Resources',          50, true),
  ('discipline', 'F00', 'Finance & Legal',          60, true),
  ('discipline', 'G00', 'HSE',                      70, true),
  ('discipline', 'H00', 'Quality Management',       80, true),
  ('discipline', 'I00', 'Project Management',       90, true),
  ('discipline', 'J00', 'Engineering',             100, true),
  ('discipline', 'K00', 'Geology',                 110, true),
  ('discipline', 'L00', 'Design',                  120, true),
  ('discipline', 'M00', 'Material & Coating',      130, true),
  ('discipline', 'N00', 'Structural',              140, true),
  ('discipline', 'O00', 'Process',                 150, true),
  ('discipline', 'P00', 'Mechanical',              160, true),
  ('discipline', 'Q00', 'Electrical and HVAC',     170, true),
  ('discipline', 'R00', 'Testing',                 180, true),
  ('discipline', 'S00', 'R&D',                     190, true),
  ('discipline', 'T00', 'Marine operation',        200, true),
  ('discipline', 'U00', 'IRM',                     210, true),
  ('discipline', 'V00', 'Seabed Intervention',     220, true),
  ('discipline', 'W00', 'Survey — General',        230, true),
  ('discipline', 'W01', 'Survey — Geophysical',    240, true),
  ('discipline', 'W02', 'Survey — Geotechnical',   250, true),
  ('discipline', 'W03', 'Survey — UXO',            260, true),
  ('discipline', 'W04', 'Survey — Environmental',  270, true),
  ('discipline', 'X00', 'Data Management',         280, true),
  ('discipline', 'X01', 'GIS & Field Layout',      290, true)
on conflict (dict_type, code) do nothing;

-- ------------------------------------------------------------------
-- language — the LANG segment of the SCL document number
-- (SC2601-SCL-RA-0012-EN, docs/00-glossary.md).
-- ------------------------------------------------------------------
insert into dcs.dictionaries (dict_type, code, label, sort_order, is_active) values
  ('language', 'EN', 'English', 10, true),
  ('language', 'PL', 'Polish',  20, true)
on conflict (dict_type, code) do nothing;

-- ------------------------------------------------------------------
-- acceptance_code — the 1–4 review codes a Reviewer or Checker issues
-- (docs/00-glossary.md, "Kody akceptacji 1–4"). Only code 3 carries a
-- description: the mandatory comment is a rule the app will have to enforce,
-- and `meta` has no key for it (see the header note) — so it is written where
-- a DC can read it on the 1a.15 screen instead of being silently dropped.
-- ------------------------------------------------------------------
insert into dcs.dictionaries (dict_type, code, label, description, sort_order, is_active) values
  ('acceptance_code', '1', 'Accepted without any comments',             null,                                                                                     10, true),
  ('acceptance_code', '2', 'Accepted with comments to be incorporated', null,                                                                                     20, true),
  ('acceptance_code', '3', 'Not accepted (to revise and re-issue)',     'A comment is mandatory for this code (docs/00-glossary.md: powrót do Originatora).',      30, true),
  ('acceptance_code', '4', 'Not reviewed, received for information only', null,                                                                                   40, true)
on conflict (dict_type, code) do nothing;

-- ------------------------------------------------------------------
-- workflow_status — the document-level state, in lifecycle order, NOT
-- alphabetical. Nine rows: the brief and the glossary write the three final
-- revisions as one line ("IFC / IFI / IFB"), but they are three distinct
-- states a single document is in, so they are three codes here — consistent
-- with docs/02-data-model.md, which already lists the states of
-- dcs.documents.workflow_status as not_started|started|idc|ifr|retcom|ifc|ifi|
-- ifb|void, nine of them, split the same way.
--
-- Codes are upper-case (NOT_STARTED, …) rather than the lower-case spelling
-- of that data-model note: within this table a code is user-facing data, and
-- six of these nine are the glossary acronyms IDC/IFR/RETCOM/IFC/IFI/IFB,
-- which are upper-case everywhere in the brief and in workflow_step below.
-- snake_case in docs/03-conventions.md governs database identifiers, not
-- dictionary values. Whether the eventual state column is an enum or an FK to
-- these rows is still O-15 — if it becomes an enum, the enum labels are the
-- data-model note's lower-case ones and these codes stay as they are.
-- ------------------------------------------------------------------
insert into dcs.dictionaries (dict_type, code, label, sort_order, is_active) values
  ('workflow_status', 'NOT_STARTED', 'Not started', 10, true),
  ('workflow_status', 'STARTED',     'Started',     20, true),
  ('workflow_status', 'IDC',         'IDC',         30, true),
  ('workflow_status', 'IFR',         'IFR',         40, true),
  ('workflow_status', 'RETCOM',      'RETCOM',      50, true),
  ('workflow_status', 'IFC',         'IFC',         60, true),
  ('workflow_status', 'IFI',         'IFI',         70, true),
  ('workflow_status', 'IFB',         'IFB',         80, true),
  ('workflow_status', 'VOID',        'Void',        90, true)
on conflict (dict_type, code) do nothing;

-- ------------------------------------------------------------------
-- workflow_step — the six steps of the document lifecycle, in lifecycle
-- order (docs/00-glossary.md, "Etap (step)": START → IDC → IFR → RETCOM →
-- IFC/IFI/IFB). Labels are the glossary's expansions; note IFB = As-Built,
-- not "Issued for Bid".
-- ------------------------------------------------------------------
insert into dcs.dictionaries (dict_type, code, label, sort_order, is_active) values
  ('workflow_step', 'IDC',    'Internal Discipline Check', 10, true),
  ('workflow_step', 'IFR',    'Issued for Review',         20, true),
  ('workflow_step', 'RETCOM', 'Returned with Comments',    30, true),
  ('workflow_step', 'IFC',    'Issued for Construction',   40, true),
  ('workflow_step', 'IFI',    'Issued for Information',    50, true),
  ('workflow_step', 'IFB',    'As-Built',                  60, true)
on conflict (dict_type, code) do nothing;
