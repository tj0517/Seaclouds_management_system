-- Create sub_project_assignments table
-- Links users to specific sub-projects within a project
CREATE TABLE IF NOT EXISTS public.sub_project_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sub_project_id UUID NOT NULL REFERENCES public.sub_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(sub_project_id, user_id)
);

-- Enable RLS
ALTER TABLE public.sub_project_assignments ENABLE ROW LEVEL SECURITY;

-- Policy: admins can do everything
CREATE POLICY "Admins can manage sub_project_assignments"
    ON public.sub_project_assignments
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Policy: users can read their own assignments
CREATE POLICY "Users can view own sub_project_assignments"
    ON public.sub_project_assignments
    FOR SELECT
    USING (auth.uid() = user_id);
