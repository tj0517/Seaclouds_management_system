-- Make projects.project_code the first segment of the DCS document number
-- (SCYYNN-SCL-...). Two inseparable steps in one migration: the data fix must
-- land before the constraint, or the ADD CONSTRAINT would reject the existing
-- rows. See docs/04-open-questions.md O-11.

-- 1. Data fix: the "IT admin" project had an empty code (verified on prod
--    2026-09-01). project_code is referenced only by uuid FK across the schema
--    (timesheet_entries/submissions via sub_project_id, user_monthly_earnings
--    and weekly_contract_codes via project_id, storage paths keyed by user_id),
--    so retagging the text orphans nothing historical.
update public.projects
   set project_code = 'SCMS-IT'
 where project_code = '' or project_code is null;

-- 2. Enforce the format going forward. SCC005 is an IMISH exception, never a
--    pattern: relaxing to '^SCC' would open the door to every future off-format
--    code. SCMS_TEST already matches '^SCMS'.
alter table public.projects
  alter column project_code set not null,
  add constraint projects_project_code_format check (
    project_code ~ '^SC\d{4}$'
    or project_code ~ '^SCMS'
    or project_code = 'SCC005'
  );

comment on constraint projects_project_code_format on public.projects is
  'project_code is the first segment of the DCS document number, so it must '
  'match SCYYNN (^SC\d{4}$) or the SCMS family (^SCMS). SCC005 (ISO '
  'Certyfikacja) is a named legacy exception, never a pattern — do not relax '
  'to ^SCC. See docs/04-open-questions.md O-11; drop the exception once the '
  'project is renumbered or archived (docs/deferred-tasks.md).';
