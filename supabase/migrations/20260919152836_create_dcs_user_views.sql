-- DCS 1b.06: dcs.user_views — a user's saved views of the MDR register.
--
-- One row is "a named set of filters and visible columns", plus at most one
-- row per user flagged as the view /mdr applies on entry. Written by the "My
-- views" control above the register (1b.06); read by nothing else.
--
-- ------------------------------------------------------------------
-- 1. No project_id, on purpose — and therefore an entry in the data model
-- ------------------------------------------------------------------
-- docs/03-conventions.md requires every dcs.* table carrying project data to
-- have project_id, and a table without one to be justified explicitly in
-- docs/02-data-model.md. This table has none, and the justification is that it
-- carries NO project data: a saved view holds the user's own filter choices,
-- one of which MAY be a project id, as an opaque value inside `filters`. The
-- row belongs to a person, not to a project.
--
-- That the filters are opaque is the point, not a shortcut. Nothing in the
-- database reads inside `filters` — no FK, no CHECK on its contents, no
-- trigger. A view saved against a project the user later loses their role on
-- restores a filter that returns zero rows, because the rows still come from
-- dcs.v_mdr under the caller's own RLS. Saving a filter has never been, and
-- must never become, a way to reach a row: dcs.v_mdr is security_invoker and
-- every read goes through it. There is nothing here to widen.
--
-- ------------------------------------------------------------------
-- 2. NO audit_trigger — a deliberate exception to the 1a.08 habit
-- ------------------------------------------------------------------
-- Every table since 1a.08 (the four core tables, dcs.dictionaries,
-- dcs.mdr_settings, public.module_permissions, the three 1b.01 register
-- tables) carries public.audit_trigger(). This one does not, and that is a
-- decision rather than an omission.
--
-- public.audit_log exists as evidence toward the client — who changed which
-- document, which revision was issued, who was granted what. These rows are
-- private UI preferences: renaming "my discipline, awaiting review" is not an
-- act anyone will ever have to account for. Logging them would put a
-- per-keystroke stream of one person's screen habits into the same table the
-- client is shown in a dispute, and the audit trail is worth less for having
-- noise in it.
--
-- The exception is narrow and does not generalise: a dcs.* table that records
-- anything about a DOCUMENT still gets the trigger.
--
-- ------------------------------------------------------------------
-- 3. Owner-only, with no admin policy
-- ------------------------------------------------------------------
-- The other dcs.* tables pair their role policies with "Admins manage X"
-- (FOR ALL, is_admin()). This table deliberately has no such policy. An
-- administrator has no more business reading someone's saved register filters
-- than reading their browser bookmarks, and there is no screen — present or
-- planned — where an admin manages another user's views. Adding one later
-- would be a decision to take then, with a reason written next to it.
--
-- Consequence worth stating: nobody but the owner can read these rows, so a
-- support request of the form "my default view is broken" is answered by
-- asking the user, not by reading the table. That is the intended trade.
create table dcs.user_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  -- The MdrQuery the register was showing when the view was saved, as the URL
  -- would carry it. Shape is the application's business (apps/dcs/lib/mdr.ts
  -- parses it, and parseMdrSearchParams is total — an unknown or malformed key
  -- becomes the default rather than an error), so the database asserts only
  -- that it is an object. A CHECK listing the keys would have to be migrated
  -- every time a filter is added to the screen.
  filters jsonb not null default '{}'::jsonb,
  -- The visible-column keys, in annex-C order, as an array of text. Empty
  -- array = every column, which is what the register shows today and what a
  -- view saved before the column picker existed would mean.
  columns jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Naming is the user's only handle on a view, so two views of the same name
  -- would be indistinguishable in the dropdown. Scoped per user: two people
  -- may both have "Awaiting review".
  constraint user_views_user_id_name_key unique (user_id, name),
  -- A name has to be typed and has to fit in a dropdown. Trimmed by the
  -- application before it arrives; the CHECK is what holds when it is not.
  constraint user_views_name_not_blank check (length(btrim(name)) between 1 and 120),
  constraint user_views_filters_is_object check (jsonb_typeof(filters) = 'object'),
  constraint user_views_columns_is_array check (jsonb_typeof(columns) = 'array')
);

-- The one read /mdr makes on entry, and the one the dropdown makes: this
-- user's views. Every query on this table is scoped to user_id — the RLS
-- policies below guarantee no other query is even possible.
create index user_views_user_id_idx on dcs.user_views (user_id);

-- AT MOST ONE DEFAULT PER USER, ENFORCED HERE AND NOT IN THE UI.
--
-- A partial unique index rather than a constraint, because "unique among the
-- rows where is_default" is not expressible as a table constraint.
--
-- How the application sets a new default, and why this index tolerates it:
-- PostgREST cannot express `set is_default = (id = $1)` in one request, so
-- apps/dcs/lib/user-views.ts does it in two — CLEAR the user's defaults, then
-- SET the chosen one, in that order. The order is the whole of the argument.
-- The intermediate state is ZERO defaults, never two, so it cannot trip this
-- index; and two tabs racing to set different defaults both clear, then one
-- wins and the other gets 23505 rather than leaving a user whose register
-- opens on a coin flip. A crash between the two requests leaves the user with
-- no default, which the next visit to /mdr shows plainly and one click fixes.
--
-- The alternative — a SECURITY INVOKER function called over RPC, giving one
-- atomic statement — was weighed and not taken: it buys only the crash window
-- above, and costs a function in the dcs schema with its own grant to keep
-- correct. Worth revisiting if that window ever turns out to matter.
create unique index user_views_one_default_per_user
  on dcs.user_views (user_id)
  where is_default;

comment on table dcs.user_views is
  'Saved MDR register views, per user (DCS 1b.06). A named set of filters and '
  'visible columns; at most one row per user carries is_default, enforced by '
  'the partial unique index user_views_one_default_per_user. No project_id: '
  'the row belongs to a person, and a project filter inside `filters` is an '
  'opaque value the database never reads. Deliberately NOT audited — these '
  'are private UI preferences, not documentation-trail data.';
comment on column dcs.user_views.filters is
  'The register query as the URL carries it. Opaque to the database: no FK, '
  'no CHECK on its contents. Restoring a filter grants no access — the rows '
  'come from dcs.v_mdr under the caller''s own RLS.';
comment on column dcs.user_views.columns is
  'Visible column keys in annex-C order. Empty array means every column, '
  'which is what a view saved before the column picker existed means.';
comment on column dcs.user_views.is_default is
  'Applied by /mdr on entry. At most one per user — see the partial unique '
  'index, not the UI.';

create trigger set_updated_at
  before update on dcs.user_views
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------
-- The dcs schema's default privileges (1a.05) grant ALL on new tables to
-- authenticated and service_role, and nothing to anon. ALL is wider than this
-- table needs (it carries TRUNCATE, REFERENCES and TRIGGER), so it is narrowed
-- to the four row operations the application performs — the same move
-- 20260919123436 made for dcs.v_mdr, and for the same reason: the guarantee
-- should be a written grant, not a leftover default.
--
-- anon is not mentioned because it has nothing to revoke; that it stays that
-- way is asserted in supabase/tests/user_views_rls.test.sql with
-- has_table_privilege and aclexplode, not with information_schema.
revoke all on dcs.user_views from authenticated, service_role;
grant select, insert, update, delete on dcs.user_views to authenticated, service_role;

alter table dcs.user_views enable row level security;

-- Four policies, one per action, all saying the same thing: the owner, and
-- nobody else. Written as four rather than one FOR ALL so that a later change
-- to one action (say, a shared-views feature touching SELECT) is an
-- `alter policy` on one command — the property 1a.11 depended on.
--
-- (select auth.uid()) rather than auth.uid(): the subquery form is evaluated
-- once per statement instead of once per row (advisor lint auth_rls_initplan,
-- docs/03-conventions.md).
create policy "Users read own views"
  on dcs.user_views for select
  using ((select auth.uid()) = user_id);

-- WITH CHECK on insert is what stops a user writing a row owned by someone
-- else. Without it the SELECT policy would hide the row from its author while
-- handing it to the victim's register.
create policy "Users insert own views"
  on dcs.user_views for insert
  with check ((select auth.uid()) = user_id);

-- Both USING and WITH CHECK. USING alone would let an owner reassign user_id
-- and push a view into another person's dropdown; WITH CHECK alone would let
-- them edit a row they do not own into one they do.
create policy "Users update own views"
  on dcs.user_views for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete own views"
  on dcs.user_views for delete
  using ((select auth.uid()) = user_id);
