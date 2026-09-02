-- DCS 1a.05, decision O-13: process_type and year are project identity shared
-- by all portal modules, so they live in public.projects; DCS-specific MDR
-- configuration goes to dcs.mdr_settings (next migration). MDR status stays
-- OUT of projects: TES already has is_active (may hours be logged), and
-- "documentation open/closed" is a different concept — see docs/02-data-model.md.

create type public.project_process_type as enum ('internal', 'tender', 'project', 'course');

alter table public.projects
  add column process_type public.project_process_type,
  add column year integer;

comment on column public.projects.process_type is
  'Brief §5.2 process type. NULL = not classified yet: for SCYYNN codes only '
  'the DC knows whether it is a project or a tender, so the backfill below '
  'deliberately fills only the certain case (^SCMS → internal).';
comment on column public.projects.year is
  'Project year from the MDR (brief §5.2). NULL for projects predating DCS.';

-- Backfill only where the mapping is certain: SCMS* codes are internal
-- company projects by definition. SCYYNN (and the named exception SCC005)
-- stay NULL — classifying them is the DC's call, not a migration's guess.
update public.projects
   set process_type = 'internal'
 where project_code like 'SCMS%';
