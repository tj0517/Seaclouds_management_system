-- DCS 1b.09, PR 1 of 2 (feat/dcs-files-storage): the bucket that holds
-- revision files and the storage.objects policies that decide who reads and
-- who uploads. The application that writes here is PR 2
-- (feat/dcs-revision-files) and opens only after this migration is confirmed
-- on production by a read (docs/03-conventions.md, "Środowiska i
-- deploymenty": the 1b.05 window).
--
-- Bucket: private, 100 MiB per object, no MIME allow-list (the DCS takes
-- drawings, models, archives; an allow-list maintained by deploy is not what
-- the brief asks for). A bucket limit is a ceiling UNDER the project's global
-- limit, never above it: on the hosted platform getFileSizeLimit() returns
-- min(global, bucket) (storage-api src/storage/limits.ts; docs "Storage >
-- Limits": a bucket limit "can't be higher than this global limit"), so
-- supabase/config.toml [storage].file_size_limit goes to 100MiB in the same
-- PR. On the LOCAL stack that key is inert and cannot be used to prove any
-- of this: CLI v2.75.0 (internal/start/start.go) hard-codes
-- UPLOAD_FILE_SIZE_LIMIT=52428800000 into the storage container and
-- storage-api v1.73.1 reads UPLOAD_FILE_SIZE_LIMIT before FILE_SIZE_LIMIT.
-- Measured 2026-09-21: with config.toml at 1MiB a 60 MB object went into a
-- bucket with no limit (HTTP 200). Bucket limits ARE enforced locally
-- (120 MB into a 100 MiB bucket: 413 EntityTooLarge).
--
-- Object layout: the first path segment is public.projects.project_code —
-- immutable since 20260915081813, format-checked since 20260901082600, and
-- already the first segment of every SCL document number. Each policy
-- resolves it to a project id through public.projects (readable by every
-- signed-in user: "Widoczność projektów", unique index unique_project_code)
-- and hands that id to the same three functions the dcs.files policies use
-- (20260903184934 — bodies unchanged here). An object outside a project
-- folder, or under a code no project has, resolves to NULL, every function
-- returns false, and no policy admits it.
--
-- The set mirrors dcs.files (20260917130035) minus its UPDATE half, with
-- ONE deliberate difference in SELECT (O-16, decided 2026-09-21 on PR #80):
--   SELECT  holders of ANY dcs.project_roles row on the project; admins.
--           NOT is_project_member(): that function is also satisfied by a
--           Timesheet project_assignments row, which is what dcs.files still
--           uses for METADATA. Bytes are narrower than metadata on purpose;
--           whether metadata should follow is the part of O-16 still open.
--           The six roles are listed literally — read from production and
--           local on 2026-09-21 (orig, rev, chk, app, dc, view) — and the
--           pgTAP file compares the list with enum_range, so a seventh role
--           has to be added here consciously rather than inheriting access.
--   INSERT  Originators of the project (any aal); Doc Controllers of the
--           project at aal2; admins
--   UPDATE  none — an object is never overwritten; a new file is a new
--           object and a new dcs.files row (upsert is refused at the API)
--   DELETE  none — nothing is deleted through the API (Void, not delete)
-- Not even the admin gets UPDATE or DELETE here, unlike "Admins manage
-- files" FOR ALL on the index table. That is deliberate.
--
-- Not in this migration: audit of downloads. public.audit_log accepts only
-- INSERT/UPDATE/DELETE and has no INSERT policy (docs/deferred-tasks.md bbb).

-- ------------------------------------------------------------------
-- 1. Bucket. ON CONFLICT DO UPDATE, not DO NOTHING (20260827125731): this
--    migration is the bucket's configuration of record, and a bucket created
--    by hand before it runs takes these values rather than keeping its own
--    (the expense-receipts drift in CLAUDE.md). Both remotes read ABSENT on
--    2026-09-21, so on scl-dev and production this is a plain insert.
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dcs-documents', 'dcs-documents', false, 104857600, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------
-- 2. Policies. TO authenticated, unlike the dcs.* policies (no TO clause)
--    and the six Timesheet storage policies (TO public). The subquery reads
--    public.projects, which anon cannot (20260831143841 revoked its grants),
--    so the policies are declared for the only role that can evaluate them.
--    anon's behaviour on storage.objects does not change: it is already a
--    42501 today, in every bucket — the 2026-08 policies call is_admin(),
--    which anon has no EXECUTE on since the same migration (measured
--    2026-09-21: "permission denied for function is_admin"). service_role
--    bypasses RLS; authenticated reads public.projects under
--    "Widoczność projektów".
-- ------------------------------------------------------------------
create policy "Project role holders read dcs documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dcs-documents'
    and public.has_project_role((
      select p.id from public.projects p
       where p.project_code = (storage.foldername(objects.name))[1]),
      array['orig', 'rev', 'chk', 'app', 'dc', 'view']::dcs.project_role[])
  );

create policy "Admins read dcs documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'dcs-documents' and (select public.is_admin()));

create policy "Originators upload dcs documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dcs-documents'
    and public.has_project_role((
      select p.id from public.projects p
       where p.project_code = (storage.foldername(objects.name))[1]),
      array['orig']::dcs.project_role[])
  );

create policy "Doc controllers upload dcs documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dcs-documents'
    and public.is_doc_controller((
      select p.id from public.projects p
       where p.project_code = (storage.foldername(objects.name))[1]))
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

create policy "Admins upload dcs documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dcs-documents' and (select public.is_admin()));
