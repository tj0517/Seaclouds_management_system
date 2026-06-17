-- Add exchange rate and PLN equivalent columns to expense_entries
ALTER TABLE expense_entries
  ADD COLUMN exchange_rate NUMERIC,
  ADD COLUMN amount_pln NUMERIC;

-- Backfill existing PLN entries
UPDATE expense_entries
SET exchange_rate = 1.0,
    amount_pln = amount
WHERE currency = 'PLN';
