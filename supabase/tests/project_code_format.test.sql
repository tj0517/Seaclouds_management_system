-- Guards the projects.project_code format constraint (migration
-- 20260901082600_enforce_project_code_format, docs/04-open-questions.md O-11):
-- rejects empty/off-format codes, accepts SCYYNN, the SCMS family and the named
-- SCC005 exception. Inserts run as postgres (the constraint is enforced for
-- everyone regardless of role).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- All seeded/migrated projects satisfy the constraint (nothing left off-format).
select is(
  (select count(*) from public.projects
    where not (project_code ~ '^SC\d{4}$'
               or project_code ~ '^SCMS'
               or project_code = 'SCC005')),
  0::bigint,
  'every existing project satisfies the project_code format constraint'
);

-- Rejections ---------------------------------------------------------------
select throws_ok(
  $$insert into public.projects (name, project_code) values ('X', '')$$,
  '23514',
  null,
  'empty project_code is rejected'
);
select throws_ok(
  $$insert into public.projects (name, project_code) values ('X', 'ABC123')$$,
  '23514',
  null,
  'off-format code ABC123 is rejected'
);
select throws_ok(
  $$insert into public.projects (name, project_code) values ('X', 'SCC006')$$,
  '23514',
  null,
  'SCC006 is rejected — SCC005 is a named exception, not a pattern'
);
-- NOT NULL (SQLSTATE 23502) is a distinct guard from the CHECK.
select throws_ok(
  $$insert into public.projects (name, project_code) values ('X', null)$$,
  '23502',
  null,
  'null project_code is rejected (NOT NULL)'
);

-- Acceptances --------------------------------------------------------------
select lives_ok(
  $$insert into public.projects (name, project_code) values ('X', 'SC2701')$$,
  'SCYYNN code SC2701 is accepted'
);
select lives_ok(
  $$insert into public.projects (name, project_code) values ('Y', 'SCMS-COS')$$,
  'SCMS-family code SCMS-COS is accepted'
);
-- SCC005 is not seeded locally, so this exercises the CHECK, not the unique key.
select lives_ok(
  $$insert into public.projects (name, project_code) values ('Z', 'SCC005')$$,
  'named exception SCC005 is accepted'
);

select * from finish();
rollback;
