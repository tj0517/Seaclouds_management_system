-- DCS 1a.05: dedicated schema for Document Control System tables (ADR-0003).
-- Core stays in public (ADR-0001); dcs.* references it via foreign keys only.
--
-- Grants mirror the post-20260831143841 state of public: authenticated and
-- service_role only, no anon and no PUBLIC — anon has nothing to do in DCS
-- (both apps query only after auth), and RLS is the row-level line of defense
-- for signed-in users. Unlike public, the dcs schema starts with no Supabase
-- bootstrap default privileges at all, so without the blocks below every new
-- dcs.* table would be invisible even to authenticated (42501 on select).

create schema dcs;

grant usage on schema dcs to authenticated, service_role;

-- Future objects created by migrations (role postgres): full access for
-- authenticated (rows filtered by RLS) and service_role, nothing for anon.
alter default privileges for role postgres in schema dcs
  grant all on tables to authenticated, service_role;
alter default privileges for role postgres in schema dcs
  grant all on sequences to authenticated, service_role;
alter default privileges for role postgres in schema dcs
  grant execute on functions to authenticated, service_role;
