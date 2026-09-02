-- DCS 1a.05: public.projects gained process_type + year (O-13) with a
-- backfill limited to the certain case (^SCMS → internal). Runs as postgres —
-- these are schema/backfill assertions, not RLS ones (rls_mdr_settings covers
-- the dcs side).
--
-- Locally the backfill's UPDATE runs before seed inserts any project, so what
-- these assertions check is the post-backfill INVARIANT (SCMS-* internal,
-- SCYYNN NULL) as encoded in seed; on remotes, where projects pre-exist, the
-- same invariant is produced by the migration itself.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_column('public', 'projects', 'process_type', 'projects.process_type exists');
select has_column('public', 'projects', 'year', 'projects.year exists');
select enum_has_labels(
  'public', 'project_process_type',
  array['internal', 'tender', 'project', 'course'],
  'project_process_type has the four brief §5.2 values'
);

select is(
  (select process_type::text from public.projects where project_code = 'SCMS-IT'),
  'internal',
  'post-backfill invariant: SCMS-* project classified as internal'
);

select is(
  (select process_type::text from public.projects where project_code = 'SC2602'),
  null,
  'post-backfill invariant: SCYYNN project stays NULL (project vs tender is the DC''s call)'
);

select is(
  (select count(*) from public.projects
    where process_type is not null and project_code not like 'SCMS%'),
  0::bigint,
  'nothing outside SCMS-* codes is classified'
);

select * from finish();
rollback;
