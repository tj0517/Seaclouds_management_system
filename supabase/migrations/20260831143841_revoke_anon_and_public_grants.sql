-- Advisor lints 0026 (pg_graphql_anon_table_exposed) and 0028
-- (anon_security_definer_function_executable): the anon role needs no access
-- to any public table or function — both apps read data only after auth
-- (Timesheet proxy.ts redirects signed-out users; DCS pages guard with
-- getUser()), and row security for signed-in users is RLS, not grants.
--
-- Function EXECUTE also flows from the implicit PUBLIC grant (proacl showed
-- `=X/postgres` on prod), so revoking anon alone would not clear lint 0028 —
-- PUBLIC must be revoked too. authenticated and service_role keep their
-- explicit grants; do NOT revoke them (lints 0027/0029 are accepted
-- deliberately — see docs/03-conventions.md, "Advisor" section).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

-- Future objects created by migrations (role postgres) must not regain anon
-- grants or PUBLIC execute, otherwise lints 0026/0028 come back with the next
-- table. authenticated/service_role stay in the default privileges untouched.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- Re-assert EXECUTE for authenticated on the functions invoked from RLS
-- policies (is_admin, is_week_locked) and via RPC (resubmit_rejected, and the
-- PM helpers reserved for upcoming policies). remote_schema.sql already grants
-- these, but the revoke of PUBLIC above plus the default-privilege change would
-- otherwise leave the guarantee implicit — pin it next to what threatens it so
-- these stay callable regardless of how the functions are later recreated.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin_or_pm() to authenticated;
grant execute on function public.is_pm_for_project(uuid) to authenticated;
grant execute on function public.is_week_locked(date, uuid) to authenticated;
grant execute on function public.is_week_locked(date, uuid, uuid) to authenticated;
grant execute on function public.resubmit_rejected(uuid, uuid) to authenticated;
