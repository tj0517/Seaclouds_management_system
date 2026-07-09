-- Rename project_manager enum value to project_lead
ALTER TYPE public.user_role RENAME VALUE 'project_manager' TO 'project_lead';

-- Update is_admin_or_pm to check for project_lead instead of project_manager
CREATE OR REPLACE FUNCTION public.is_admin_or_pm()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'project_lead')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update is_pm_for_project to check for project_lead instead of project_manager
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
