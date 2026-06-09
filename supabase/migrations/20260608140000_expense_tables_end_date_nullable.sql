-- Make end_date nullable on expense_tables
ALTER TABLE public.expense_tables ALTER COLUMN end_date DROP NOT NULL;
