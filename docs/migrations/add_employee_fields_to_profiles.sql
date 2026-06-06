-- Add employee fields to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employee_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS rate_hourly NUMERIC,
  ADD COLUMN IF NOT EXISTS rate_daily NUMERIC;
