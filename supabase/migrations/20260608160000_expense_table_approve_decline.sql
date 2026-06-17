ALTER TABLE public.expense_tables
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by UUID REFERENCES auth.users(id);
