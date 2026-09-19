-- Tests for DCS 1b.06: dcs.user_views — saved views of the MDR register.
-- Migration 20260919152836_create_dcs_user_views.
--
-- Pattern follows mdr_register_view.test.sql (1b.05): fixtures as postgres
-- inside this transaction (rolled back at the end), then impersonation via
-- `set local role authenticated` + request.jwt.claims carrying an explicit
-- aal, exactly like PostgREST. Every "this user sees / does not see"
-- assertion is a bare count(*) with no WHERE (docs/03-conventions.md): the
-- difference between users has to be made by the database, not the query.
--
-- Three things worth reading before the assertions:
--
--   * THE FAILING CASE IS NOT AN ERROR. Under RLS, B's UPDATE and DELETE
--     against A's row do not raise — they match zero rows and succeed
--     silently. A test written as `throws_ok` on those would fail against a
--     CORRECT policy, and — much worse — a test that only asserts "no error"
--     would pass against a BROKEN one. So each one is proved twice: the
--     statement returns nothing (is_empty on RETURNING), and A's row is then
--     re-read as postgres and found untouched. Only the INSERT denial is a
--     real 42501, because a WITH CHECK violation is an error.
--
--   * THERE IS NO ADMIN POLICY AND THAT IS ASSERTED, not just absent.
--     Every other dcs.* table pairs its role policies with "Admins manage X"
--     (FOR ALL, is_admin()). Section 3 pins the policy count at four and the
--     command set at the four row operations, so restoring the habitual admin
--     policy here fails a test rather than quietly widening who can read a
--     colleague's saved filters. The reasoning is in the migration header.
--
--   * THE ABSENT AUDIT TRIGGER IS ALSO ASSERTED. 1b.06 deliberately does not
--     attach public.audit_trigger() (private UI preferences are not
--     documentation-trail data — migration header, section 2). Section 1
--     asserts zero triggers beyond set_updated_at, so adding it back out of
--     habit is caught here, where the reason is written down.
--
-- Cast:
--   user A  views-a@example.com   owns two views, one of them the default
--   user B  views-b@example.com   owns one view, and must reach none of A's
--
-- public.profiles rows come from the handle_new_user() trigger on
-- auth.users — the same path 1b.05's file relies on.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

-- ============================================================
-- 1. Shape (red without the migration)
-- ============================================================
select has_table('dcs', 'user_views', 'table dcs.user_views exists');

select columns_are('dcs', 'user_views',
  array['id', 'user_id', 'name', 'filters', 'columns', 'is_default',
        'created_at', 'updated_at'],
  'dcs.user_views has exactly the eight columns the task specifies — and no project_id, which is the justified exception recorded in docs/02-data-model.md');

select col_type_is('dcs', 'user_views', 'filters', 'jsonb',
  'filters is jsonb — the register query as the URL carries it');
select col_type_is('dcs', 'user_views', 'columns', 'jsonb',
  'columns is jsonb — the visible-column keys, in annex-C order');
select col_type_is('dcs', 'user_views', 'is_default', 'boolean',
  'is_default is boolean');

-- A saved view must not outlive the account that owns it: nobody else can
-- read these rows, so a row left behind by a deleted profile is unreachable
-- forever.
select ok(
  (select c.confdeltype = 'c'
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'dcs' and t.relname = 'user_views'
      and c.contype = 'f'
      and c.conkey = array[(select attnum from pg_attribute
                             where attrelid = 'dcs.user_views'::regclass
                               and attname = 'user_id')]),
  'user_id references public.profiles ON DELETE CASCADE — a deleted account leaves no unreachable rows behind');

select has_index('dcs', 'user_views', 'user_views_user_id_idx',
  'user_views_user_id_idx exists — the one read /mdr makes on entry');

-- THE assertion behind acceptance criterion 5: at most one default per user,
-- in the DATABASE. Both halves are named, because an index that is unique but
-- not partial would forbid a user having two views at all, and one that is
-- partial but not unique would forbid nothing.
select has_index('dcs', 'user_views', 'user_views_one_default_per_user',
  'user_views_one_default_per_user exists');
select ok(
  (select indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE is_default%'
     from pg_indexes
    where schemaname = 'dcs' and indexname = 'user_views_one_default_per_user'),
  'user_views_one_default_per_user is UNIQUE and PARTIAL (WHERE is_default) — one default per user, not one view per user');

select has_trigger('dcs', 'user_views', 'set_updated_at',
  'set_updated_at keeps updated_at honest on rename and on re-save');

-- The deliberate exception, asserted so it cannot be "fixed" by habit.
select is(
  (select count(*) from pg_trigger
    where tgrelid = 'dcs.user_views'::regclass and not tgisinternal),
  1::bigint,
  'dcs.user_views carries set_updated_at and NOTHING else — no audit_trigger, deliberately (migration header, section 2)');

-- ============================================================
-- 2. Grants — the four row operations, and nothing for anon
-- ============================================================
select ok(has_table_privilege('authenticated', 'dcs.user_views', 'select'),
  'authenticated may SELECT dcs.user_views');
select ok(has_table_privilege('authenticated', 'dcs.user_views', 'insert'),
  'authenticated may INSERT dcs.user_views');
select ok(has_table_privilege('authenticated', 'dcs.user_views', 'update'),
  'authenticated may UPDATE dcs.user_views');
select ok(has_table_privilege('authenticated', 'dcs.user_views', 'delete'),
  'authenticated may DELETE dcs.user_views');
select ok(not has_table_privilege('authenticated', 'dcs.user_views', 'truncate'),
  'authenticated may NOT TRUNCATE — the dcs default privileges grant ALL, and the migration narrows it back to the four row operations');

-- Acceptance criterion: anon has NO privileges. Proved with
-- has_table_privilege, NOT with information_schema.role_table_grants, which
-- filters by the connecting role and returns null for grants that do exist.
-- One assertion per command, not a single conjunction: a combined ok() that
-- goes red tells you anon gained SOMETHING, and leaves you to find out what.
select ok(not has_table_privilege('anon', 'dcs.user_views', 'select'),
  'anon may NOT select dcs.user_views');
select ok(not has_table_privilege('anon', 'dcs.user_views', 'insert'),
  'anon may NOT insert dcs.user_views');
select ok(not has_table_privilege('anon', 'dcs.user_views', 'update'),
  'anon may NOT update dcs.user_views');
select ok(not has_table_privilege('anon', 'dcs.user_views', 'delete'),
  'anon may NOT delete dcs.user_views');

-- The same fact read from the other side: anon appears nowhere in the ACL.
-- has_table_privilege answers "can this role", aclexplode answers "is it
-- written down" — a grant to PUBLIC would satisfy neither role check above
-- while still being an entry here.
select is(
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'dcs' and c.relname = 'user_views'
      and (a.grantee = 'anon'::regrole::oid or a.grantee = 0)),
  0::bigint,
  'aclexplode(relacl) lists no grant to anon and none to PUBLIC (grantee 0) on dcs.user_views');

select ok(
  has_table_privilege('service_role', 'dcs.user_views', 'select')
  and has_table_privilege('service_role', 'dcs.user_views', 'insert')
  and has_table_privilege('service_role', 'dcs.user_views', 'update')
  and has_table_privilege('service_role', 'dcs.user_views', 'delete'),
  'service_role keeps the same four operations');

-- ============================================================
-- 3. RLS is on, and the policy set is exactly four owner-only policies
-- ============================================================
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dcs' and c.relname = 'user_views'),
  'row level security is ENABLED on dcs.user_views');

select policies_are('dcs', 'user_views',
  array['Users read own views', 'Users insert own views',
        'Users update own views', 'Users delete own views'],
  'exactly four policies, one per action — and no "Admins manage user views", which is the decision in the migration header, not an oversight');

-- Named separately from policies_are because a FOR ALL policy could be added
-- under one of those four names and slip past a name-only check.
select is(
  (select count(*) from pg_policy where polrelid = 'dcs.user_views'::regclass and polcmd = '*'),
  0::bigint,
  'no FOR ALL policy on dcs.user_views — an admin cannot read a colleague''s saved filters');

-- ============================================================
-- 4. Fixtures — two users, three views, inside this transaction
-- ============================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token,
  phone_change, phone_change_token, email_change_token_current, email_change_confirm_status)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, 'x', now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(),
  '', '', '', '', '', '', '', 0
from (values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid, 'views-a@example.com', 'Views user A'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2'::uuid, 'views-b@example.com', 'Views user B')
) as u(id, email, name);

create temp table t_fixture as
select
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'::uuid as a_id,
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'::uuid as b_id;
grant select on t_fixture to authenticated;

-- A owns two, one of them the default. B owns one, named IDENTICALLY to one
-- of A's — so "B sees one row" cannot be satisfied by name collision, and the
-- per-user uniqueness of names is exercised by the fixture itself.
insert into dcs.user_views (user_id, name, filters, columns, is_default)
select a_id, 'Awaiting review', '{"status":"idc","sort":"issue_date"}'::jsonb,
       '["scl_doc_number","title","workflow_status_code"]'::jsonb, true
from t_fixture;
insert into dcs.user_views (user_id, name, filters, columns, is_default)
select a_id, 'My discipline', '{"discipline":"a00"}'::jsonb, '[]'::jsonb, false
from t_fixture;
insert into dcs.user_views (user_id, name, filters, columns, is_default)
select b_id, 'Awaiting review', '{"status":"ifr"}'::jsonb, '[]'::jsonb, false
from t_fixture;

-- ============================================================
-- 5. The constraints, as postgres (RLS-exempt — this section is about CHECKs
--    and indexes, not about who may do what)
-- ============================================================
select throws_ok(
  $$insert into dcs.user_views (user_id, name)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '   ')$$,
  '23514', null,
  'a blank name is refused — the trimmed length must be at least 1');
select throws_ok(
  $$insert into dcs.user_views (user_id, name)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', repeat('x', 121))$$,
  '23514', null,
  'a name longer than 120 characters is refused');
select throws_ok(
  $$insert into dcs.user_views (user_id, name, filters)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Array filters', '[]'::jsonb)$$,
  '23514', null,
  'filters must be a JSON object, not an array');
select throws_ok(
  $$insert into dcs.user_views (user_id, name, columns)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Object columns', '{}'::jsonb)$$,
  '23514', null,
  'columns must be a JSON array, not an object');
select throws_ok(
  $$insert into dcs.user_views (user_id, name)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Awaiting review')$$,
  '23505', null,
  'a user may not have two views of the same name');
select lives_ok(
  $$insert into dcs.user_views (user_id, name)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'My discipline')$$,
  'but two DIFFERENT users may each have a view of the same name — the uniqueness is per user');

-- Acceptance criterion 5, the assertion it exists for.
select throws_ok(
  $$insert into dcs.user_views (user_id, name, is_default)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Second default', true)$$,
  '23505', null,
  'a user may NOT have two default views — the partial unique index refuses the second, in the database and not in the UI');
select lives_ok(
  $$insert into dcs.user_views (user_id, name, is_default)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'B default', true)$$,
  'and the index is per user: B may have a default while A already has one');
-- Put the fixture back to two views for A and two for B before impersonation.
delete from dcs.user_views where name = 'B default';
delete from dcs.user_views where name = 'My discipline'
  and user_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

-- Read as postgres (RLS-exempt) rather than hard-coded, so these stay true if
-- the fixture counts above change.
create temp table t_all_rows as
select (select count(*) from dcs.user_views) as everywhere,
       (select count(*) from dcs.user_views
         where user_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1') as a_rows,
       (select count(*) from dcs.user_views
         where user_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2') as b_rows;
grant select on t_all_rows to authenticated;

select cmp_ok((select everywhere from t_all_rows), '>', (select a_rows from t_all_rows),
  'sanity: another user''s views exist, so "A sees only their own" is a real filter and not an empty one');

-- ============================================================
-- 6. GREEN — the owner does everything with their own views
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select a_id from t_fixture), 'role', 'authenticated', 'aal', 'aal1')::text, true);

select is((select count(*) from dcs.user_views), (select a_rows from t_all_rows),
  'GREEN: A sees exactly their own views — every one of them (bare count, no WHERE)');
-- The whole restore path in ONE assertion: the view /mdr opens on, with the
-- filters and the column set that were saved.
--
-- results_eq and not three `is((select col from …))` comparisons, and the
-- reason is the red proof rather than tidiness. A scalar subquery raises
-- "more than one row returned by a subquery used as an expression" the moment
-- a broken SELECT policy lets A see B's identically-named view — and a raised
-- error ABORTS the transaction, so every assertion below it, including the
-- entire RED section this file exists for, never runs. Measured: with
-- "Users read own views" set to USING (true), the earlier scalar form failed
-- test 32 and then aborted, reporting one failure where there are eight. A
-- set comparison fails and lets the file continue.
select results_eq(
  $$select name, filters, columns from dcs.user_views where is_default$$,
  $$values ('Awaiting review'::text,
            '{"sort":"issue_date","status":"idc"}'::jsonb,
            '["scl_doc_number","title","workflow_status_code"]'::jsonb)$$,
  'GREEN: A''s default view — the one /mdr applies on entry — comes back with exactly the filters and column set that were saved');

select lives_ok(
  $$insert into dcs.user_views (user_id, name, filters)
    values ((select auth.uid()), 'Saved from the toolbar', '{"q":"RA-00"}'::jsonb)$$,
  'GREEN: A saves a new view');
select lives_ok(
  $$update dcs.user_views set name = 'Renamed by its owner'
     where name = 'Saved from the toolbar'$$,
  'GREEN: A renames their own view');

-- The move the "mark as default" control actually makes, in the order it
-- makes it: CLEAR then SET, two statements, because PostgREST cannot express
-- `set is_default = (id = $1)` in one request (see the migration header).
-- Asserted as two steps rather than one convenient UPDATE precisely so this
-- proves the path apps/dcs/lib/user-views.ts takes. The order is the point:
-- the intermediate state is ZERO defaults, which the partial unique index
-- permits. SET-then-CLEAR would raise 23505 on the first statement.
select lives_ok(
  $$update dcs.user_views set is_default = false
     where user_id = (select auth.uid()) and is_default$$,
  'GREEN: step 1 — A clears their current default');
select lives_ok(
  $$update dcs.user_views set is_default = true
     where user_id = (select auth.uid()) and name = 'My discipline'$$,
  'GREEN: step 2 — and sets the new one; zero defaults in between is a state the partial index allows');
select is(
  (select count(*) from dcs.user_views where is_default),
  1::bigint,
  'GREEN: and A still has exactly one default afterwards');
-- results_eq for the same reason as the restore assertion above: a leaking
-- SELECT policy must make this FAIL, not abort the file.
select results_eq(
  $$select name from dcs.user_views where is_default$$,
  $$values ('My discipline'::text)$$,
  'GREEN: the default moved to the view A picked, and it is the only one');

select lives_ok(
  $$delete from dcs.user_views where name = 'Renamed by its owner'$$,
  'GREEN: A deletes their own view');
select is((select count(*) from dcs.user_views), (select a_rows from t_all_rows),
  'GREEN: and A is back to the views they started with');

-- ============================================================
-- 7. RED — B reaches none of A's views
--
-- The acceptance criterion in one section: user A's view is invisible and
-- unmodifiable to user B. Every assertion here fails if the owner-only
-- policies are broken, and section 3 above is what stops them being replaced
-- by a wider one.
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub', (select b_id from t_fixture), 'role', 'authenticated', 'aal', 'aal2')::text, true);

select is((select count(*) from dcs.user_views), (select b_rows from t_all_rows),
  'RED: B sees ONLY their own views — a bare count returns B''s row count, not the table''s');
select is(
  (select count(*) from dcs.user_views where name = 'My discipline'),
  0::bigint,
  'RED: A''s "My discipline" is invisible to B, by name');
select is(
  (select count(*) from dcs.user_views where is_default),
  0::bigint,
  'RED: and B cannot read which view A opens the register on');
select is(
  (select count(*) from dcs.user_views where filters ->> 'discipline' = 'a00'),
  0::bigint,
  'RED: nor reach it by filtering on its contents — a WHERE cannot widen what RLS returned');

-- These two do not raise. Under RLS they match zero rows and succeed, which
-- is exactly why each is proved twice — here, and as postgres in section 8.
select is_empty(
  $$update dcs.user_views set name = 'hijacked', is_default = true
     where name = 'My discipline' returning id$$,
  'RED: B''s UPDATE against A''s view touches NOTHING — it returns no row rather than raising, which is what RLS does');
select is_empty(
  $$delete from dcs.user_views where name = 'My discipline' returning id$$,
  'RED: B''s DELETE against A''s view removes NOTHING');
select is_empty(
  $$update dcs.user_views set is_default = true
     where user_id <> (select auth.uid()) returning id$$,
  'RED: nor can B set a default on somebody else''s behalf');

-- This one IS an error: a WITH CHECK violation, not an invisible row.
select throws_ok(
  $$insert into dcs.user_views (user_id, name)
    values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Planted by B')$$,
  '42501', null,
  'RED: B may not INSERT a view owned by A — without WITH CHECK the row would be hidden from its author and delivered to A''s dropdown');

-- B reassigning one of their OWN rows to A is the same attack from the other
-- direction, and is refused by the UPDATE policy's WITH CHECK.
select throws_ok(
  $$update dcs.user_views set user_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
     where name = 'Awaiting review'$$,
  '42501', null,
  'RED: B may not push their own view into A''s dropdown by reassigning user_id — this is what WITH CHECK on UPDATE buys');

reset role;

-- ============================================================
-- 8. The other half of the RED proof: A's rows are untouched
--
-- Section 7's UPDATE and DELETE succeeded. Read back as postgres, which no
-- policy filters, to show they changed nothing — a test that stopped at "no
-- error" would pass against a policy that let B through.
-- ============================================================
select is(
  (select count(*) from dcs.user_views
    where user_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  (select a_rows from t_all_rows),
  'A still has every view they had before B tried — the DELETE removed nothing');
select is(
  (select count(*) from dcs.user_views where name = 'hijacked'),
  0::bigint,
  'and nothing anywhere carries the name B tried to write');
select is(
  (select count(*) from dcs.user_views where name = 'Planted by B'),
  0::bigint,
  'B''s refused INSERT left no row behind');
select is(
  (select count(*) from dcs.user_views
    where user_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
  (select b_rows from t_all_rows),
  'and B still owns exactly the views B started with — the refused reassignment did not move one out either');
select is(
  (select count(*) from dcs.user_views
    where is_default and user_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
  1::bigint,
  'A has exactly one default view, and it is still A''s own choice');

-- ============================================================
-- 9. What this file does NOT cover
-- ============================================================
-- * The .xlsx export itself. It runs over HTTP against PostgREST and cannot
--   see this uncommitted transaction; its fidelity is proved end-to-end by
--   scripts/mdr-export-fidelity.mjs against the local stack instead.
-- * What is INSIDE `filters`. Deliberately: the database does not read it
--   (migration header, section 1), and a test asserting a key set here would
--   freeze a shape that apps/dcs/lib/mdr.ts owns.
-- * Whether restoring a saved filter can reach a document. It cannot, and the
--   proof is not here: rows come from dcs.v_mdr under security_invoker, which
--   supabase/tests/mdr_register_view.test.sql section 8 covers.
select * from finish();
rollback;
