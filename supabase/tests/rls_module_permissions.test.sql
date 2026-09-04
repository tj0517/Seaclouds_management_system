-- Tests for DCS 1a.22: public.module_permissions — shape, constraints, RLS,
-- the default-grant trigger and the audit trigger. Follows
-- rls_dictionaries.test.sql: fixtures as postgres inside this transaction
-- (rolled back), then impersonation via authenticated/anon +
-- request.jwt.claims, exactly like PostgREST.
--
-- Cast (seed + one user created here):
--   admin    tjezionekspam@gmail.com  profiles.role = admin
--   tymon    tjezionek2000@gmail.com  plain employee
--   ernest   ejezionek@gmail.com      plain employee
--   outsider created below            no profile row until fixture insert
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- ============================================================
-- Schema assertions (red without the migration)
-- ============================================================
select has_table('public', 'module_permissions', 'table public.module_permissions exists');
select columns_are('public', 'module_permissions',
  array['id', 'user_id', 'module', 'granted_at'],
  'module_permissions: exactly the 1a.22 columns');
select col_is_pk('public', 'module_permissions', 'id', 'id is the primary key (audit_trigger requires it)');
select col_is_fk('public', 'module_permissions', 'user_id', 'user_id is a foreign key');
select col_is_unique('public', 'module_permissions', array['user_id', 'module'],
  '(user_id, module) is unique — presence, not a boolean, encodes the grant');
select is(
  (select array_agg(enumlabel order by enumsortorder)
    from pg_enum where enumtypid = 'public.portal_module'::regtype)::text[],
  array['tes', 'dcs', 'bms']::text[], 'portal_module has exactly tes, dcs, bms, in that order');

select has_trigger('public', 'module_permissions', 'audit_module_permissions',
  'audit_module_permissions trigger is attached');
select is(
  (select tgfoid::regproc::text from pg_trigger
    where tgrelid = 'public.module_permissions'::regclass and tgname = 'audit_module_permissions'),
  'audit_trigger', 'audit_module_permissions executes public.audit_trigger()');
select has_trigger('public', 'profiles', 'grant_default_module_access',
  'grant_default_module_access trigger is attached to profiles');

select policies_are('public', 'module_permissions',
  array['Users read own module permissions', 'Admins manage module permissions'],
  'module_permissions: exactly the two 1a.22 policies');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'module_permissions' and cmd = 'SELECT'
      and qual like '%auth.uid()%' and qual like '%user_id%'),
  1::bigint, 'the self-read policy is gated on auth.uid() = user_id');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'module_permissions' and cmd = 'ALL'
      and qual like '%is_admin()%' and with_check like '%is_admin()%'),
  1::bigint, 'the admin write policy is gated on is_admin() (USING and WITH CHECK)');

-- ============================================================
-- Fixtures (as postgres)
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
values
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-4fff-8fff-fffffffffff1',
   'authenticated', 'authenticated', 'outsider-1a22@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Outsider 1a22"}', now(), now(),
   '', '', '', '', '', '', '', 0);

create temp table t_fixture as
select
  (select id from auth.users where email = 'tjezionekspam@gmail.com') as admin_id,
  (select id from auth.users where email = 'tjezionek2000@gmail.com') as tymon_id,
  (select id from auth.users where email = 'ejezionek@gmail.com') as ernest_id,
  'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid as outsider_id;
grant select on t_fixture to authenticated;

-- Sanity: the profiles INSERT trigger already granted TES to every seed
-- user (including the outsider just created above) — nothing manual.
select is((select count(*) from public.module_permissions where module = 'tes'), 4::bigint,
  'sanity: every one of the 4 profiles (3 seed + outsider) already has TES from the default-grant trigger');
select is((select count(*) from public.module_permissions where module = 'dcs'), 0::bigint,
  'sanity: nobody has DCS yet — the data migration ran before these fixture users existed');

-- Give the admin DCS access directly, as postgres, mirroring what the 1a.22
-- data migration does for real admin rows on dev/prod (the fixture users
-- here are created after that migration ran, so they start from zero).
insert into public.module_permissions (user_id, module)
values ((select admin_id from t_fixture), 'dcs');

-- ============================================================
-- 1. Constraints (as postgres — RLS is not what is being tested here)
-- ============================================================
select throws_ok(
  format($$insert into public.module_permissions (user_id, module) values ('%s', 'tes')$$,
    (select tymon_id from t_fixture)),
  '23505', null, 'RED: duplicate (user_id, module) is rejected (23505) — tymon already has tes');
select throws_ok(
  $$insert into public.module_permissions (user_id, module) values (gen_random_uuid(), 'tes')$$,
  '23503', null, 'RED: a user_id with no matching profile is rejected (23503, FK)');

-- ============================================================
-- 2. anon: nothing
-- ============================================================
set local role anon;
select throws_ok('select count(*) from public.module_permissions', '42501', null,
  'RED: anon cannot select from module_permissions (no grants)');
reset role;

-- ============================================================
-- 3. Plain employee (ernest): reads only his own row, writes nothing
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select ernest_id from t_fixture), 'role', 'authenticated')::text, true);

select is((select count(*) from public.module_permissions), 1::bigint,
  'GREEN: employee sees exactly one row — his own');
select is((select module from public.module_permissions limit 1), 'tes',
  'GREEN: the one row ernest sees is his own TES grant');
select is(
  (select count(*) from public.module_permissions where user_id <> (select ernest_id from t_fixture)),
  0::bigint, 'RED: ernest sees no other user''s rows, including the admin''s DCS grant');

select throws_ok(
  format($$insert into public.module_permissions (user_id, module) values ('%s', 'dcs')$$,
    (select ernest_id from t_fixture)),
  '42501', null, 'RED: employee cannot grant DCS to himself (42501)');
update public.module_permissions set module = 'dcs'
 where user_id = (select ernest_id from t_fixture) and module = 'tes';
select is(
  (select count(*) from public.module_permissions
    where user_id = (select ernest_id from t_fixture) and module = 'dcs'),
  0::bigint, 'RED: employee UPDATE (attempting to relabel his own TES grant as DCS) affects zero rows');
delete from public.module_permissions where user_id = (select ernest_id from t_fixture);
select is(
  (select count(*) from public.module_permissions where user_id = (select ernest_id from t_fixture)),
  1::bigint, 'RED: employee DELETE of his own row affects zero rows (only admins write)');

-- ============================================================
-- 4. Outsider: same shape as ernest — sees only his own TES row
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select outsider_id from t_fixture), 'role', 'authenticated')::text, true);
select is((select count(*) from public.module_permissions), 1::bigint,
  'GREEN: outsider also sees exactly one row — his own default TES grant');
select throws_ok(
  format($$insert into public.module_permissions (user_id, module) values ('%s', 'bms')$$,
    (select outsider_id from t_fixture)),
  '42501', null, 'RED: outsider cannot grant himself BMS (42501)');

-- ============================================================
-- 5. Admin: full read/write, every write lands in audit_log
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select admin_id from t_fixture), 'role', 'authenticated')::text, true);

select cmp_ok((select count(*) from public.module_permissions), '>=', 5::bigint,
  'GREEN: admin sees every row (4 default TES + his own DCS grant), not just his own');

select lives_ok(
  format($$insert into public.module_permissions (user_id, module) values ('%s', 'dcs')$$,
    (select tymon_id from t_fixture)),
  'GREEN: admin can grant DCS to tymon');
select is(
  (select count(*) from public.module_permissions
    where user_id = (select tymon_id from t_fixture) and module = 'dcs'),
  1::bigint, 'GREEN: the grant to tymon took effect');
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.module_permissions' and action = 'INSERT'
      and user_id = (select admin_id from t_fixture)
      and new_value ->> 'user_id' = (select tymon_id from t_fixture)::text
      and new_value ->> 'module' = 'dcs'),
  1::bigint, 'GREEN: the grant is audited with the admin''s own user_id');

select lives_ok(
  format($$delete from public.module_permissions where user_id = '%s' and module = 'dcs'$$,
    (select tymon_id from t_fixture)),
  'GREEN: admin can revoke DCS from tymon');
select is(
  (select count(*) from public.module_permissions
    where user_id = (select tymon_id from t_fixture) and module = 'dcs'),
  0::bigint, 'GREEN: the revocation took effect');
select is(
  (select count(*) from public.audit_log
    where table_name = 'public.module_permissions' and action = 'DELETE'
      and user_id = (select admin_id from t_fixture)
      and old_value ->> 'module' = 'dcs'
      and old_value ->> 'user_id' = (select tymon_id from t_fixture)::text),
  1::bigint, 'GREEN: the revocation is audited, carrying the removed row');

-- ============================================================
-- 6. Default grant (acceptance criterion 3): a brand-new user ends up with
-- TES yes / DCS no / BMS no with no manual step — proven here by creating
-- one more user as postgres and reading the result without touching
-- module_permissions at all.
-- ============================================================
reset role;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
values
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-4fff-8fff-fffffffffff2',
   'authenticated', 'authenticated', 'brandnew-1a22@example.com', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Brand New"}', now(), now(),
   '', '', '', '', '', '', '', 0);

select is(
  (select array_agg(module order by module) from public.module_permissions
    where user_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2')::text[],
  array['tes']::text[],
  'GREEN: a brand-new profile has exactly TES and nothing else, with no manual grant');

select * from finish();
rollback;
