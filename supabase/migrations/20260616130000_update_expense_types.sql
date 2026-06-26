-- Rename existing enum values and add new ones (idempotent)

-- Step 1: Rename existing values (only if they still have the old name)
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

-- Step 2: Add new values
ALTER TYPE expense_type ADD VALUE IF NOT EXISTS 'bus';
ALTER TYPE expense_type ADD VALUE IF NOT EXISTS 'train';

-- Step 3: Migrate existing data that used removed types (safe to re-run, no-op if none exist)
DO $$ BEGIN
  UPDATE expense_entries SET expense_type = 'other' WHERE expense_type = 'parking';
EXCEPTION WHEN invalid_text_representation THEN NULL;
END $$;

DO $$ BEGIN
  UPDATE expense_entries SET expense_type = 'other' WHERE expense_type = 'office_supplies';
EXCEPTION WHEN invalid_text_representation THEN NULL;
END $$;

-- Note: PostgreSQL does not support removing enum values directly.
-- 'parking' and 'office_supplies' will remain in the enum but won't be used by the UI.
