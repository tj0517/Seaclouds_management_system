-- Make end_date nullable on expense_tables (idempotent)
-- ALTER COLUMN ... DROP NOT NULL is safe to re-run
ALTER TABLE public.expense_tables ALTER COLUMN end_date DROP NOT NULL;
