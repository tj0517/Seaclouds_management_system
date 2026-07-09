-- Add project_manager to user_role enum
ALTER TYPE public.user_role ADD VALUE 'project_manager';

-- Returns true if current user is admin OR project_manager
CREATE OR REPLACE FUNCTION public.is_admin_or_pm()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'project_manager')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Returns true if PM is assigned to the given project
CREATE OR REPLACE FUNCTION public.is_pm_for_project(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles pr
    JOIN public.project_assignments pa ON pa.user_id = pr.id
    WHERE pr.id = auth.uid()
      AND pr.role = 'project_manager'
      AND pa.project_id = p_project_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
