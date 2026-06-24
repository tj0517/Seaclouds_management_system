-- Base schema migration: recreates the full production schema so Supabase branches work.
-- This must be the FIRST migration (earliest timestamp).

-- ============================================================
-- Enums
-- ============================================================
CREATE TYPE user_role AS ENUM ('admin', 'employee');
CREATE TYPE expense_currency AS ENUM ('PLN', 'EUR', 'USD', 'GBP');
CREATE TYPE expense_type AS ENUM ('taxi', 'lodging', 'meals', 'plane_ticket', 'parking', 'office_supplies', 'mileage', 'other', 'bus', 'train');

-- ============================================================
-- Tables (ordered by dependency)
-- ============================================================

-- profiles (references auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  role user_role DEFAULT 'employee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  employee_id TEXT UNIQUE,
  position TEXT,
  rate_hourly NUMERIC,
  rate_daily NUMERIC,
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);

-- projects
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  project_code TEXT,
  CONSTRAINT unique_project_code UNIQUE (project_code)
);

-- sub_projects
CREATE TABLE sub_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  tracking_type TEXT NOT NULL DEFAULT 'hours',
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT sub_projects_project_id_code_key UNIQUE (project_id, code)
);

-- project_assignments
CREATE TABLE project_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT project_assignments_project_id_user_id_key UNIQUE (project_id, user_id)
);

-- sub_project_assignments
CREATE TABLE sub_project_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sub_project_id UUID NOT NULL REFERENCES sub_projects(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sub_project_assignments_sub_project_id_user_id_key UNIQUE (sub_project_id, user_id)
);

-- timesheet_entries
CREATE TABLE timesheet_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  work_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  hours NUMERIC DEFAULT 0,
  sub_project_id UUID NOT NULL REFERENCES sub_projects(id)
);

-- timesheet_submissions
CREATE TABLE timesheet_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  week_start DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ DEFAULT now(),
  sub_project_id UUID NOT NULL REFERENCES sub_projects(id),
  reject_reason TEXT,
  CONSTRAINT unique_submission_per_subproject_week UNIQUE (user_id, sub_project_id, week_start)
);

-- pdf_exports
CREATE TABLE pdf_exports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id),
  month TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT pdf_exports_user_id_month_key UNIQUE (user_id, month)
);

-- expense_tables
CREATE TABLE expense_tables (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  work_order TEXT,
  purpose TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'draft',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  decline_reason TEXT
);

-- expense_entries
CREATE TABLE expense_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_table_id UUID NOT NULL REFERENCES expense_tables(id),
  expense_date DATE NOT NULL,
  expense_date_end DATE,
  location TEXT,
  expense_type expense_type NOT NULL,
  description TEXT,
  currency expense_currency NOT NULL DEFAULT 'PLN',
  amount NUMERIC NOT NULL,
  km NUMERIC,
  km_rate NUMERIC,
  receipt_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exchange_rate NUMERIC,
  amount_pln NUMERIC
);

-- user_monthly_earnings
CREATE TABLE user_monthly_earnings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id),
  project_id UUID REFERENCES projects(id),
  year_month TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PLN',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- weekly_contract_codes (already in a later migration, but needed for base)
-- This will be skipped by the later migration file since the table already exists.
CREATE TABLE weekly_contract_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  contract_code TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, project_id, week_start)
);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_week_locked(entry_date date, entry_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  monday DATE;
BEGIN
  monday := date_trunc('week', entry_date)::DATE;
  RETURN EXISTS (
    SELECT 1
    FROM public.timesheet_submissions
    WHERE user_id = entry_user
      AND week_start = monday
      AND status IN ('submitted', 'approved')
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_week_locked(entry_date date, entry_user uuid, entry_sub_project uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  monday DATE;
BEGIN
  monday := date_trunc('week', entry_date)::DATE;
  RETURN EXISTS (
    SELECT 1
    FROM public.timesheet_submissions
    WHERE user_id = entry_user
      AND week_start = monday
      AND sub_project_id = entry_sub_project
      AND status IN ('submitted', 'approved')
  );
END;
$$;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', 'employee');
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE TRIGGER trg_earnings_updated_at
  BEFORE UPDATE ON user_monthly_earnings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_monthly_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_contract_codes ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Bezpieczny dostęp do profili" ON profiles FOR SELECT USING ((auth.uid() = id) OR is_admin());
CREATE POLICY "Użytkownicy edytują swoje dane" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins can update profiles" ON profiles FOR UPDATE TO authenticated USING ((SELECT profiles_1.role FROM profiles profiles_1 WHERE profiles_1.id = auth.uid()) = 'admin'::user_role);

-- projects
CREATE POLICY "Widoczność projektów" ON projects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Admin zarządza projektami" ON projects FOR ALL USING (is_admin());

-- project_assignments
CREATE POLICY "Widoczność przypisań" ON project_assignments FOR SELECT USING ((auth.uid() = user_id) OR is_admin());
CREATE POLICY "Admin zmienia przypisania" ON project_assignments FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admin usuwa przypisania" ON project_assignments FOR DELETE USING (is_admin());

-- sub_project_assignments
CREATE POLICY "Users can view own sub_project_assignments" ON sub_project_assignments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage sub_project_assignments" ON sub_project_assignments FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- sub_projects
CREATE POLICY "Widoczność kodów" ON sub_projects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Admin zarządza kodami" ON sub_projects FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- timesheet_entries
CREATE POLICY "Widoczność wpisów" ON timesheet_entries FOR SELECT USING ((auth.uid() = user_id) OR (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'::user_role)));
CREATE POLICY "Pracownik dodaje godziny (jeśli niezablokowane)" ON timesheet_entries FOR INSERT WITH CHECK ((auth.uid() = user_id) AND (NOT is_week_locked(work_date, auth.uid())));
CREATE POLICY "Pracownik dodaje godziny (jeśli podprojekt niezablokowany)" ON timesheet_entries FOR INSERT WITH CHECK ((auth.uid() = user_id) AND (NOT is_week_locked(work_date, auth.uid(), sub_project_id)));
CREATE POLICY "Pracownik edytuje godziny (jeśli niezablokowane)" ON timesheet_entries FOR UPDATE USING ((auth.uid() = user_id) AND (NOT is_week_locked(work_date, auth.uid()))) WITH CHECK ((auth.uid() = user_id) AND (NOT is_week_locked(work_date, auth.uid())));
CREATE POLICY "Pracownik edytuje godziny (jeśli podprojekt niezablokowany)" ON timesheet_entries FOR UPDATE USING ((auth.uid() = user_id) AND (NOT is_week_locked(work_date, auth.uid(), sub_project_id)));
CREATE POLICY "Pracownik usuwa godziny (jeśli niezablokowane)" ON timesheet_entries FOR DELETE USING ((auth.uid() = user_id) AND (NOT is_week_locked(work_date, auth.uid())));
CREATE POLICY "Pracownik usuwa godziny (jeśli podprojekt niezablokowany)" ON timesheet_entries FOR DELETE USING ((auth.uid() = user_id) AND (NOT is_week_locked(work_date, auth.uid(), sub_project_id)));

-- timesheet_submissions
CREATE POLICY "Pracownik widzi swoje statusy" ON timesheet_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Pracownik może zatwierdzić tydzień" ON timesheet_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Pracownik cofa zatwierdzenie" ON timesheet_submissions FOR DELETE USING ((auth.uid() = user_id) AND (status = 'submitted'));
CREATE POLICY "Admin zarządza statusami" ON timesheet_submissions FOR ALL USING (is_admin());

-- pdf_exports
CREATE POLICY "Users can read own exports" ON pdf_exports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can read all exports" ON pdf_exports FOR SELECT USING (is_admin());

-- expense_tables
CREATE POLICY "Users can view own expense tables" ON expense_tables FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own expense tables" ON expense_tables FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own expense tables" ON expense_tables FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own expense tables" ON expense_tables FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all expense tables" ON expense_tables FOR SELECT USING (is_admin());
CREATE POLICY "Admins can update all expense tables" ON expense_tables FOR UPDATE USING (is_admin());

-- expense_entries
CREATE POLICY "Users can view own expense entries" ON expense_entries FOR SELECT USING (EXISTS (SELECT 1 FROM expense_tables et WHERE et.id = expense_entries.expense_table_id AND et.user_id = auth.uid()));
CREATE POLICY "Users can insert own expense entries" ON expense_entries FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM expense_tables et WHERE et.id = expense_entries.expense_table_id AND et.user_id = auth.uid()));
CREATE POLICY "Users can update own expense entries" ON expense_entries FOR UPDATE USING (EXISTS (SELECT 1 FROM expense_tables et WHERE et.id = expense_entries.expense_table_id AND et.user_id = auth.uid()));
CREATE POLICY "Users can delete own expense entries" ON expense_entries FOR DELETE USING (EXISTS (SELECT 1 FROM expense_tables et WHERE et.id = expense_entries.expense_table_id AND et.user_id = auth.uid()));
CREATE POLICY "Admins can view all expense entries" ON expense_entries FOR SELECT USING (is_admin());

-- user_monthly_earnings
CREATE POLICY "Admins can select earnings" ON user_monthly_earnings FOR SELECT USING (is_admin());
CREATE POLICY "Admins can insert earnings" ON user_monthly_earnings FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update earnings" ON user_monthly_earnings FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete earnings" ON user_monthly_earnings FOR DELETE USING (is_admin());

-- weekly_contract_codes
CREATE POLICY "Users manage own contract codes" ON weekly_contract_codes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins read all" ON weekly_contract_codes FOR SELECT USING (is_admin());

-- ============================================================
-- RLS: Allow employee to UPDATE own rejected submissions for resubmit
-- ============================================================
CREATE POLICY "Pracownik resubmituje odrzucone" ON timesheet_submissions FOR UPDATE USING (auth.uid() = user_id AND status = 'rejected') WITH CHECK (auth.uid() = user_id);
