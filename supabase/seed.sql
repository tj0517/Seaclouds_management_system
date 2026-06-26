-- Seed data for Supabase branch
-- Fully automated: creates auth users, profiles, projects, and sample data.
-- All test users have password: password123

-- ============================================================
-- Step 1: Create auth users with proper password + identity
-- ============================================================
-- bcrypt hash of "password123" (cost 10)
-- Generated via: SELECT crypt('password123', gen_salt('bf'));

DO $$
DECLARE
  uid_ernest UUID := gen_random_uuid();
  uid_tymon UUID := gen_random_uuid();
  uid_admin UUID := gen_random_uuid();
  pwd_hash TEXT := crypt('password123', gen_salt('bf'));
  now_ts TIMESTAMPTZ := now();
  pid_it UUID := '094e130b-599b-4295-87fa-697fb71e7fc4';
  pid_pej UUID := '6c0909ce-9b74-4bda-8e92-10811ff5a0fc';
  spid_timesheet UUID := '39ac163d-d2d0-4b5d-96dc-1516363dad27';
  spid_ctr122 UUID := '45d231d4-3c58-4679-b4fb-97d521d9e712';
  spid_ctr142 UUID := '465a6119-d9aa-4398-bb2c-47ec1274f51c';
BEGIN

  -- ============================================================
  -- Auth users (password: password123)
  -- ============================================================
  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new,
    recovery_token, phone_change, phone_change_token,
    email_change_token_current, email_change_confirm_status
  ) VALUES
    (
      '00000000-0000-0000-0000-000000000000', uid_ernest, 'authenticated', 'authenticated',
      'ejezionek@gmail.com', pwd_hash, now_ts,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Ernest Jezionek"}'::jsonb,
      now_ts, now_ts,
      '', '', '', '', '', '', '', 0
    ),
    (
      '00000000-0000-0000-0000-000000000000', uid_tymon, 'authenticated', 'authenticated',
      'tjezionek2000@gmail.com', pwd_hash, now_ts,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Tymon"}'::jsonb,
      now_ts, now_ts,
      '', '', '', '', '', '', '', 0
    ),
    (
      '00000000-0000-0000-0000-000000000000', uid_admin, 'authenticated', 'authenticated',
      'tjezionekspam@gmail.com', pwd_hash, now_ts,
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"ADMIN"}'::jsonb,
      now_ts, now_ts,
      '', '', '', '', '', '', '', 0
    );

  -- ============================================================
  -- Auth identities (required for email/password login)
  -- ============================================================
  INSERT INTO auth.identities (
    id, user_id, provider_id, provider,
    identity_data, last_sign_in_at,
    created_at, updated_at
  ) VALUES
    (
      gen_random_uuid(), uid_ernest, uid_ernest::text, 'email',
      format('{"sub":"%s","email":"ejezionek@gmail.com","email_verified":true}', uid_ernest)::jsonb,
      now_ts, now_ts, now_ts
    ),
    (
      gen_random_uuid(), uid_tymon, uid_tymon::text, 'email',
      format('{"sub":"%s","email":"tjezionek2000@gmail.com","email_verified":true}', uid_tymon)::jsonb,
      now_ts, now_ts, now_ts
    ),
    (
      gen_random_uuid(), uid_admin, uid_admin::text, 'email',
      format('{"sub":"%s","email":"tjezionekspam@gmail.com","email_verified":true}', uid_admin)::jsonb,
      now_ts, now_ts, now_ts
    );

  -- ============================================================
  -- Profiles (update trigger-created rows)
  -- ============================================================
  UPDATE profiles SET full_name = 'Ernest Jezionek', role = 'employee' WHERE id = uid_ernest;
  UPDATE profiles SET full_name = 'Tymon', role = 'employee', position = 'It support', rate_hourly = 65 WHERE id = uid_tymon;
  UPDATE profiles SET full_name = 'ADMIN', role = 'admin', rate_hourly = 100, rate_daily = 300 WHERE id = uid_admin;

  -- ============================================================
  -- Projects
  -- ============================================================
  INSERT INTO projects (id, name, description, project_code, is_active, created_at) VALUES
    (pid_it, 'IT admin', NULL, '', true, '2026-06-01 09:55:28.317983+00'),
    (pid_pej, 'PEJ/131/2026_UXO&GEO Oversight', 'UXO & GEO Oversight', 'SC2602', true, '2026-06-01 10:14:35.589029+00')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- Sub Projects
  -- ============================================================
  INSERT INTO sub_projects (id, project_id, code, description, is_active, is_deleted, tracking_type, created_at) VALUES
    (spid_timesheet, pid_it, 'timesheet', '', true, false, 'hours', '2026-06-01 09:55:39.458815+00'),
    (spid_ctr122, pid_pej, 'SC2602_CTR122', 'Analytic Work_Survey', true, false, 'hours', '2026-06-02 09:03:29.854814+00'),
    (spid_ctr142, pid_pej, 'SC2602_CTR142', 'Offshore OPS', true, false, 'days', '2026-06-02 08:52:08.81805+00')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- Project Assignments
  -- ============================================================
  INSERT INTO project_assignments (project_id, user_id) VALUES
    (pid_it, uid_tymon),
    (pid_pej, uid_admin),
    (pid_pej, uid_ernest),
    (pid_it, uid_admin)
  ON CONFLICT (project_id, user_id) DO NOTHING;

  -- ============================================================
  -- Sub Project Assignments
  -- ============================================================
  INSERT INTO sub_project_assignments (sub_project_id, user_id) VALUES
    (spid_timesheet, uid_tymon),
    (spid_ctr142, uid_admin),
    (spid_ctr122, uid_admin),
    (spid_ctr142, uid_ernest),
    (spid_ctr122, uid_ernest),
    (spid_timesheet, uid_admin)
  ON CONFLICT (sub_project_id, user_id) DO NOTHING;

  -- ============================================================
  -- Timesheet Entries (sample data)
  -- ============================================================
  INSERT INTO timesheet_entries (user_id, sub_project_id, work_date, hours) VALUES
    -- Tymon: IT admin timesheet
    (uid_tymon, spid_timesheet, '2026-06-01', 3),
    (uid_tymon, spid_timesheet, '2026-06-02', 2.5),
    (uid_tymon, spid_timesheet, '2026-06-03', 1),
    (uid_tymon, spid_timesheet, '2026-06-04', 3),
    (uid_tymon, spid_timesheet, '2026-06-05', 1),
    (uid_tymon, spid_timesheet, '2026-06-06', 1.5),
    (uid_tymon, spid_timesheet, '2026-06-07', 2),
    -- Ernest: PEJ project
    (uid_ernest, spid_ctr142, '2026-06-01', 1),
    (uid_ernest, spid_ctr142, '2026-06-03', 1),
    (uid_ernest, spid_ctr122, '2026-06-01', 2),
    (uid_ernest, spid_ctr142, '2026-06-08', 1),
    (uid_ernest, spid_ctr142, '2026-06-10', 1),
    (uid_ernest, spid_ctr122, '2026-06-08', 2),
    -- Admin: PEJ project
    (uid_admin, spid_ctr142, '2026-06-01', 1),
    (uid_admin, spid_ctr142, '2026-06-04', 1),
    (uid_admin, spid_ctr122, '2026-06-03', 2),
    (uid_admin, spid_ctr122, '2026-06-04', 3),
    (uid_admin, spid_ctr142, '2026-06-08', 1),
    (uid_admin, spid_ctr142, '2026-06-11', 1),
    (uid_admin, spid_ctr122, '2026-06-10', 2),
    (uid_admin, spid_ctr122, '2026-06-11', 3),
    (uid_admin, spid_ctr122, '2026-06-15', 1),
    (uid_admin, spid_ctr122, '2026-06-16', 2),
    (uid_admin, spid_ctr142, '2026-06-16', 1),
    (uid_admin, spid_ctr142, '2026-06-20', 1),
    (uid_admin, spid_ctr142, '2026-06-21', 1),
    (uid_admin, spid_timesheet, '2026-06-17', 12)
  ON CONFLICT (user_id, sub_project_id, work_date) DO NOTHING;

  -- ============================================================
  -- Timesheet Submissions (some submitted weeks)
  -- ============================================================
  INSERT INTO timesheet_submissions (user_id, sub_project_id, week_start, status) VALUES
    (uid_tymon, spid_timesheet, '2026-06-01', 'submitted'),
    (uid_ernest, spid_ctr142, '2026-05-25', 'submitted'),
    (uid_ernest, spid_ctr122, '2026-06-01', 'submitted'),
    (uid_ernest, spid_ctr142, '2026-06-08', 'submitted'),
    (uid_admin, spid_ctr122, '2026-06-01', 'submitted'),
    (uid_admin, spid_ctr142, '2026-06-01', 'submitted'),
    (uid_admin, spid_ctr142, '2026-06-08', 'submitted'),
    (uid_admin, spid_ctr122, '2026-06-08', 'submitted'),
    (uid_admin, spid_ctr142, '2026-06-15', 'submitted'),
    (uid_admin, spid_ctr122, '2026-06-15', 'submitted')
  ON CONFLICT (user_id, sub_project_id, week_start) DO NOTHING;

  -- ============================================================
  -- Expense Tables (sample)
  -- ============================================================
  INSERT INTO expense_tables (id, user_id, project_id, work_order, purpose, start_date, end_date, status) VALUES
    ('db99936a-1ca9-4e99-bcab-4623ba317a3f', uid_tymon, pid_it, '1133123', 'IT costs', '2026-06-08', '2026-06-21', 'approved'),
    ('9af8e1b7-08ca-45e4-a7ed-2937bdd42b51', uid_admin, pid_pej, '1223', 'Travel expenses', '2026-06-09', '2026-06-30', 'approved')
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- Expense Entries
  -- ============================================================
  INSERT INTO expense_entries (id, expense_table_id, expense_date, location, expense_type, description, currency, amount, km, km_rate, exchange_rate, amount_pln) VALUES
    ('647da614-d890-471b-88da-f1c02fb60112', 'db99936a-1ca9-4e99-bcab-4623ba317a3f', '2026-06-08', NULL, 'mileage', 'Office commute', 'PLN', 12, 1, 12, 1, 12),
    ('362b8e4c-242d-4a37-b829-2f24743e5cc4', 'db99936a-1ca9-4e99-bcab-4623ba317a3f', '2026-06-05', NULL, 'meals', 'Lunch', 'EUR', 12, NULL, NULL, 4.2348, 50.82),
    ('fc6d8b67-7edc-4586-9663-04afb6faea88', '9af8e1b7-08ca-45e4-a7ed-2937bdd42b51', '2026-06-14', 'Gdansk', 'taxi', 'Taxi to site', 'PLN', 45, NULL, NULL, 1, 45)
  ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- Fix NULL string columns in auth.users (GoTrue scans them as non-nullable strings)
  -- ============================================================
  UPDATE auth.users SET
    confirmation_token  = COALESCE(confirmation_token, ''),
    email_change        = COALESCE(email_change, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    recovery_token      = COALESCE(recovery_token, ''),
    phone_change        = COALESCE(phone_change, ''),
    phone_change_token  = COALESCE(phone_change_token, ''),
    email_change_confirm_status = COALESCE(email_change_confirm_status, 0);

END $$;
