-- Cleanup duplicate and conflicting RLS policies
-- Run this in Supabase SQL Editor

-- 1. CRITICAL: Remove unrestricted timesheet_entries policies that bypass lock checks
--    Since PERMISSIVE policies are OR'd, these override the lock-checking policies
DROP POLICY "Dodawanie wpisów" ON public.timesheet_entries;
DROP POLICY "Edycja wpisów" ON public.timesheet_entries;
DROP POLICY "Usuwanie wpisów" ON public.timesheet_entries;

-- 2. Remove duplicate SELECT policy on projects
DROP POLICY "Wszyscy widzą projekty" ON public.projects;

-- 3. Remove duplicate INSERT policy on project_assignments
--    Keeping "Admin zmienia przypisania" which uses is_admin() (cleaner)
DROP POLICY "Admin zarządza przypisaniami" ON public.project_assignments;
