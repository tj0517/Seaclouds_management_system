-- Add reviewed_at and reviewed_by columns to expense_tables (idempotent)
ALTER TABLE public.expense_tables
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.expense_tables
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id);
