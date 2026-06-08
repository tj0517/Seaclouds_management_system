CREATE TABLE weekly_contract_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  contract_code TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, project_id, week_start)
);

ALTER TABLE weekly_contract_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own contract codes" ON weekly_contract_codes
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Admins read all" ON weekly_contract_codes
  FOR SELECT USING (is_admin());
