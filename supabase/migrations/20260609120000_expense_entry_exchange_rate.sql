-- Add exchange rate and PLN equivalent columns to expense_entries (idempotent)
ALTER TABLE expense_entries
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC;

ALTER TABLE expense_entries
  ADD COLUMN IF NOT EXISTS amount_pln NUMERIC;

-- Backfill existing PLN entries (safe to re-run)
UPDATE expense_entries
SET exchange_rate = 1.0,
    amount_pln = amount
WHERE currency = 'PLN'
  AND exchange_rate IS NULL;
