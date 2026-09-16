-- Tests for DCS 1a.18: the dictionary content seeded by migration
-- 20260916094843_seed_dcs_dictionaries. Unlike rls_dictionaries.test.sql
-- (shape, constraints, policies) this file asserts the *data* — the counts,
-- the orders and the one meta key that has a defined meaning — so that a
-- later edit to the seed migration, or a stray row added by another
-- migration, fails here rather than in DC's face on the 1a.15 screen.
--
-- Everything runs as postgres: nothing here is about RLS, and the read
-- policy on dcs.dictionaries is already proven next door.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ============================================================
-- 1. Counts per dictionary — the acceptance criteria of 1a.18.
-- discipline is 29 (brief table B.2), not the 32 the planning note quotes;
-- workflow_status is 9 because IFC/IFI/IFB are three states, not one.
-- ============================================================
select bag_eq(
  $$select dict_type, count(*) from dcs.dictionaries where is_active group by 1$$,
  $$values ('acceptance_code', 4::bigint), ('area', 4::bigint), ('discipline', 29::bigint),
           ('doc_type', 23::bigint), ('language', 2::bigint), ('workflow_status', 9::bigint),
           ('workflow_step', 6::bigint)$$,
  'every dictionary holds exactly the number of active entries 1a.18 seeds');

-- ============================================================
-- 2. Orders that are not alphabetical, and would silently regress.
-- ============================================================
select results_eq(
  $$select code from dcs.dictionaries where dict_type = 'workflow_step' order by sort_order$$,
  $$values ('IDC'), ('IFR'), ('RETCOM'), ('IFC'), ('IFI'), ('IFB')$$,
  'workflow_step is in lifecycle order (IDC → IFR → RETCOM → IFC → IFI → IFB), not alphabetical');

select results_eq(
  $$select code from dcs.dictionaries where dict_type = 'workflow_status' order by sort_order$$,
  $$values ('NOT_STARTED'), ('STARTED'), ('IDC'), ('IFR'), ('RETCOM'),
           ('IFC'), ('IFI'), ('IFB'), ('VOID')$$,
  'workflow_status is in lifecycle order, with IFC/IFI/IFB split into three codes');

select is(
  (select label from dcs.dictionaries where dict_type = 'workflow_step' and code = 'IFB'),
  'As-Built', 'IFB is As-Built (docs/00-glossary.md), not "Issued for Bid"');

-- doc_type is alphabetical by code and starts above 0, so no seeded row ever
-- ties with a hand-made one (scl-dev's TST sits at sort_order 0).
select results_eq(
  $$select code from dcs.dictionaries where dict_type = 'doc_type' and is_active order by sort_order$$,
  $$select code from dcs.dictionaries where dict_type = 'doc_type' and is_active order by code$$,
  'doc_type sort_order follows the alphabetical order of the code');
select is(
  (select min(sort_order) from dcs.dictionaries where dict_type = 'doc_type' and is_active),
  10, 'the lowest seeded doc_type sort_order is 10, above the column default of 0');

-- ============================================================
-- 3. meta.budget_hours — the only key with a defined meaning
-- (docs/02-data-model.md), and only on doc_type.
-- ============================================================
select results_eq(
  $$select code, (meta->>'budget_hours')::int from dcs.dictionaries
     where dict_type = 'doc_type' and code in ('GD', 'RA', 'XD') order by code$$,
  $$values ('GD', 24), ('RA', 60), ('XD', 80)$$,
  'budget hours of GD / RA / XD are 24 / 60 / 80');
select is(
  (select label from dcs.dictionaries where dict_type = 'doc_type' and code = 'RA'),
  'Report', 'RA is Report (the brief), not Risk Assessment');
select is(
  (select count(*) from dcs.dictionaries where dict_type = 'doc_type' and is_active
     and (meta->>'budget_hours') is null),
  0::bigint, 'every seeded doc_type carries a budget_hours');
select is(
  (select count(*) from dcs.dictionaries where dict_type <> 'doc_type' and is_active
     and meta <> '{}'::jsonb),
  0::bigint, 'no other dictionary carries meta — budget_hours is doc_type-only and no other key is defined yet');

-- Acceptance code 3 records the mandatory comment in description, because
-- meta has no comment_required key (1a.18 header note).
select matches(
  (select description from dcs.dictionaries where dict_type = 'acceptance_code' and code = '3'),
  'mandatory', 'acceptance code 3 says in its description that a comment is mandatory');

-- ============================================================
-- 4. RED: the CHECK still refuses a dict_type the seed does not cover —
-- process_type (brief B.4) is deliberately NOT a dictionary.
-- ============================================================
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('process_type', 'TENDER', 'Tender')$$,
  '23514', null, 'RED: process_type is not a dictionary type (dictionaries_dict_type_check)');

-- ============================================================
-- 5. Idempotency comes from ON CONFLICT DO NOTHING, not from luck.
-- ============================================================
with again as (
  insert into dcs.dictionaries (dict_type, code, label, sort_order)
  values ('language', 'EN', 'English (re-run)', 999)
  on conflict (dict_type, code) do nothing
  returning 1
)
select is((select count(*) from again), 0::bigint,
  'GREEN: re-inserting a seeded row with ON CONFLICT DO NOTHING inserts nothing');
select throws_ok(
  $$insert into dcs.dictionaries (dict_type, code, label) values ('language', 'EN', 'English (re-run)')$$,
  '23505', null,
  'RED: the same re-insert WITHOUT the clause is a unique violation — idempotency is the clause, not the data');

select * from finish();
rollback;
