-- Consolidated migration: sync main DB schema to match staging (idempotent)
-- Combines: 20260609130000, 20260612100000, 20260616120000, 20260616130000

-- 1. Admin update policy on expense_tables
DO $$ BEGIN
  CREATE POLICY "Admins can update all expense tables"
    ON public.expense_tables FOR UPDATE
    USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. User monthly earnings table
CREATE TABLE IF NOT EXISTS public.user_monthly_earnings (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id  UUID          REFERENCES public.projects(id) ON DELETE SET NULL,
  year_month  TEXT          NOT NULL,  -- 'YYYY-MM'
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency    TEXT          NOT NULL DEFAULT 'PLN',
  notes       TEXT,
  created_by  UUID          NOT NULL REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_earnings_user_month_no_project
  ON public.user_monthly_earnings(user_id, year_month)
  WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_earnings_user_month_with_project
  ON public.user_monthly_earnings(user_id, year_month, project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_earnings_user_id    ON public.user_monthly_earnings(user_id);
CREATE INDEX IF NOT EXISTS idx_earnings_year_month ON public.user_monthly_earnings(year_month);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  CREATE TRIGGER trg_earnings_updated_at
    BEFORE UPDATE ON public.user_monthly_earnings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.user_monthly_earnings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can select earnings" ON public.user_monthly_earnings FOR SELECT USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can insert earnings" ON public.user_monthly_earnings FOR INSERT WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can update earnings" ON public.user_monthly_earnings FOR UPDATE USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can delete earnings" ON public.user_monthly_earnings FOR DELETE USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add decline_reason column to expense_tables
ALTER TABLE public.expense_tables
  ADD COLUMN IF NOT EXISTS decline_reason TEXT;

-- 4. Update expense_type enum: rename values and add new ones
DO $$ BEGIN
  ALTER TYPE expense_type RENAME VALUE 'flight' TO 'plane_ticket';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE expense_type RENAME VALUE 'personal_car' TO 'mileage';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE expense_type RENAME VALUE 'hotel' TO 'lodging';
EXCEPTION WHEN invalid_parameter_value THEN NULL;
END $$;

ALTER TYPE expense_type ADD VALUE IF NOT EXISTS 'bus';
ALTER TYPE expense_type ADD VALUE IF NOT EXISTS 'train';

-- Migrate stale enum values to 'other' (no-op if no data exists)
DO $$ BEGIN
  UPDATE expense_entries SET expense_type = 'other' WHERE expense_type = 'parking';
EXCEPTION WHEN invalid_text_representation THEN NULL;
END $$;

DO $$ BEGIN
  UPDATE expense_entries SET expense_type = 'other' WHERE expense_type = 'office_supplies';
EXCEPTION WHEN invalid_text_representation THEN NULL;
END $$;
