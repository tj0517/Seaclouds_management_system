ALTER TABLE public.expense_tables
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
