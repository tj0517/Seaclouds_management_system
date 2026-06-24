-- Add decline_reason column to expense_tables (idempotent)
ALTER TABLE public.expense_tables
  ADD COLUMN IF NOT EXISTS decline_reason TEXT;
