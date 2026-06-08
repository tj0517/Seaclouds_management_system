-- Create pdf_exports table
CREATE TABLE IF NOT EXISTS pdf_exports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    month TEXT NOT NULL, -- format: YYYY-MM
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, month)
);

-- Enable RLS
ALTER TABLE pdf_exports ENABLE ROW LEVEL SECURITY;

-- Users can read their own exports
CREATE POLICY "Users can read own exports"
    ON pdf_exports FOR SELECT
    USING (auth.uid() = user_id);

-- Admins can read all exports
CREATE POLICY "Admins can read all exports"
    ON pdf_exports FOR SELECT
    USING (is_admin());

-- Service role handles inserts/updates (via admin client)
-- No insert/update policies needed for regular users since server actions use admin client

-- Create storage bucket for timesheet exports
INSERT INTO storage.buckets (id, name, public)
VALUES ('timesheet-exports', 'timesheet-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can read their own exports
CREATE POLICY "Users can read own export files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'timesheet-exports'
        AND (storage.foldername(name))[1] = 'exports'
        AND (storage.foldername(name))[2] = auth.uid()::text
    );

-- Admins can read all export files
CREATE POLICY "Admins can read all export files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'timesheet-exports'
        AND is_admin()
    );
