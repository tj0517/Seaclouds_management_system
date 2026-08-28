-- Rename the project_manager enum value to project_lead and update both
-- helper functions in the same migration. The rename and the function bodies
-- must change together: these functions are called from RLS policies, and a
-- stale 'project_manager' literal inside them would not fail at rename time,
-- only at first call — locking users out. db push runs this file in a single
-- transaction.

ALTER TYPE public.user_role RENAME VALUE 'project_manager' TO 'project_lead';

CREATE OR REPLACE FUNCTION public.is_admin_or_pm()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'project_lead')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_pm_for_project(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles pr
    JOIN public.project_assignments pa ON pa.user_id = pr.id
    WHERE pr.id = auth.uid()
      AND pr.role = 'project_lead'
      AND pa.project_id = p_project_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
