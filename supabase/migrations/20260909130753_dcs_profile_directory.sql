-- DCS 1a.14b: makes ADR-0012 real. 1a.14 granted dcs.project_roles but the
-- /dcs project list still reads public.projects with no filter (its only
-- SELECT policy, "Widoczność projektów", admits every authenticated user —
-- inherited from Timesheet, out of scope to narrow, see 02-data-model.md and
-- the 1a.14 review note (aa) that reversed an earlier plan to add a new
-- projects policy). The fix is entirely app-side: apps/dcs's own project
-- list query filters by the caller's own dcs.project_roles rows.
--
-- A DC also cannot see co-members' names: public.profiles SELECT
-- ("Bezpieczny dostęp do profili") is own-row-or-admin, so the 1a.14 team
-- table falls back to truncated ids and the "add member" picker is empty
-- for a non-admin DC. A profiles RLS policy widening SELECT to "any project
-- co-member" would leak rate_hourly/rate_daily (brief: rates are never
-- shown outside admin/self) — RLS is row-level, it cannot hide a column.
-- So this is a SECURITY DEFINER function returning exactly (id, full_name),
-- the same shape as is_project_member/is_doc_controller/is_any_doc_controller
-- (1a.09/1a.09b): "public, next to is_admin(); its body is untouched" is the
-- established home for these cross-schema helpers, not a new dcs.* function.
--
-- Visibility: admin or any DC (is_admin() / is_any_doc_controller(), both
-- project-less like this function) see the whole directory — matches 1a.14b's
-- acceptance criterion 3 ("Notion says DC can add a member" — any DC, not
-- just the project's own DC, since the function has no project argument).
-- A plain member sees co-members of any project they hold a dcs.project_roles
-- row on, plus always their own row.

create function public.dcs_profile_directory()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
    from public.profiles p
   where (select public.is_admin())
      or (select public.is_any_doc_controller())
      or p.id = auth.uid()
      or exists (
           select 1
             from dcs.project_roles mine
             join dcs.project_roles theirs
               on theirs.project_id = mine.project_id
            where mine.user_id = auth.uid()
              and theirs.user_id = p.id
         );
$$;

comment on function public.dcs_profile_directory() is
  'Name directory for DCS screens: (id, full_name) only, never rates/email/'
  'position — a profiles RLS policy could not do this without leaking a '
  'column. admin or any DC (is_admin()/is_any_doc_controller(), both '
  'project-less) see every profile; a plain member sees co-members of any '
  'project they hold a dcs.project_roles row on, plus always their own row.';

-- Same grant shape as is_project_member/is_doc_controller/is_any_doc_controller:
-- authenticated needs EXECUTE because callers invoke it directly (RPC), not
-- from a policy expression this time — but the grant pattern is identical
-- and the advisor lint (0029) it trips is the same accepted class.
grant execute on function public.dcs_profile_directory() to authenticated;
revoke execute on function public.dcs_profile_directory() from anon, public;
