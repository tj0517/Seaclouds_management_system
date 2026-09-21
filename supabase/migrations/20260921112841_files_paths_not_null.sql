-- DCS 1b.09, PR 1 of 2: dcs.files.file_name, original_name and storage_path
-- become NOT NULL. 20260917130035 left them nullable "until 1b.09" because
-- nothing wrote the table and NOT NULL would have been a promise no code
-- kept. From PR 2 on every row is written by the upload action with all
-- three set; a row without a storage_path is an index entry pointing at
-- nothing. dcs.files holds 0 rows on scl-dev and on production (read
-- 2026-09-21), so there is nothing to backfill and no USING clause.
alter table dcs.files
  alter column file_name set not null,
  alter column original_name set not null,
  alter column storage_path set not null;

comment on table dcs.files is
  'Files of one revision (brief §5.5). The bytes live in Supabase Storage '
  '(bucket dcs-documents, first path segment = projects.project_code, '
  '1b.09) and are reachable only through signed URLs; this table is the '
  'index. file_name is the generated name '
  '([SCL_DOC_NUMBER]_[REV]_[STEP]_[YYYY-MM-DD]_[NN].[ext]), original_name '
  'the uploaded one, storage_path the object key — all three NOT NULL since '
  '1b.09. The write lock on final revisions is 1b.10.';
