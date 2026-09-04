-- DCS 1a.11 / O-14: require aal2 (password + TOTP) for DC writes on
-- dcs.dictionaries. Frontend enforcement (proxy.ts redirect to /mfa) is the
-- UX; this migration is the guarantee that survives a direct PostgREST/SQL
-- call bypassing the frontend.
--
-- Scope: DC write policies only, per acceptance criterion 2. The admin ALL
-- policy ("Admins manage dictionaries") is untouched — out of scope for this
-- task, not requested.
--
-- is_any_doc_controller() itself is untouched (1a.09b) — the aal2 check is
-- ANDed onto the existing policies via `alter policy`, matching the
-- single-command (INSERT/UPDATE) structure 1a.09b deliberately left in
-- place for this. DELETE stays admin-only and uncovered here, same as
-- before.

alter policy "Doc controllers insert dictionaries" on dcs.dictionaries
  with check (
    (select public.is_any_doc_controller())
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

alter policy "Doc controllers update dictionaries" on dcs.dictionaries
  using (
    (select public.is_any_doc_controller())
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    (select public.is_any_doc_controller())
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );
