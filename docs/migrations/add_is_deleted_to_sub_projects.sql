-- Add is_deleted column to sub_projects for soft-delete functionality
-- When is_deleted = true, the sub-project is hidden from all UI but preserved in DB
-- This is separate from is_active which controls temporary activation/deactivation
ALTER TABLE public.sub_projects
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE NOT NULL;
