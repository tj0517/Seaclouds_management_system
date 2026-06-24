-- Add status column to expense_tables (idempotent)
ALTER TABLE public.expense_tables
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
