-- Rename existing enum values and add new ones
-- Step 1: Rename existing values
ALTER TYPE expense_type RENAME VALUE 'flight' TO 'plane_ticket';
ALTER TYPE expense_type RENAME VALUE 'personal_car' TO 'mileage';
ALTER TYPE expense_type RENAME VALUE 'hotel' TO 'lodging';

-- Step 2: Add new values
ALTER TYPE expense_type ADD VALUE IF NOT EXISTS 'bus';
ALTER TYPE expense_type ADD VALUE IF NOT EXISTS 'train';

-- Step 3: Migrate existing data that used removed types
UPDATE expense_entries SET expense_type = 'other' WHERE expense_type = 'parking';
UPDATE expense_entries SET expense_type = 'other' WHERE expense_type = 'office_supplies';

-- Note: PostgreSQL does not support removing enum values directly.
-- 'parking' and 'office_supplies' will remain in the enum but won't be used by the UI.
