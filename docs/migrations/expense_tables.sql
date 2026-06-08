-- Expense tables feature migration

-- Enums
CREATE TYPE public.expense_type AS ENUM (
  'taxi', 'hotel', 'meals', 'flight', 'parking', 'office_supplies', 'personal_car', 'other'
);

CREATE TYPE public.expense_currency AS ENUM (
  'PLN', 'EUR', 'USD', 'GBP'
);

-- Expense tables (containers for trip/assignment expenses)
CREATE TABLE public.expense_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_order TEXT,
  purpose TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_tables_user_id ON public.expense_tables(user_id);
CREATE INDEX idx_expense_tables_project_id ON public.expense_tables(project_id);

-- Expense entries (individual expense rows within a table)
CREATE TABLE public.expense_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_table_id UUID NOT NULL REFERENCES public.expense_tables(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  expense_date_end DATE,
  location TEXT,
  expense_type public.expense_type NOT NULL,
  description TEXT,
  currency public.expense_currency NOT NULL DEFAULT 'PLN',
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  km NUMERIC(10,2),
  km_rate NUMERIC(10,4),
  receipt_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_entries_table_id ON public.expense_entries(expense_table_id);
CREATE INDEX idx_expense_entries_date ON public.expense_entries(expense_date);

-- RLS for expense_tables
ALTER TABLE public.expense_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own expense tables"
  ON public.expense_tables FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all expense tables"
  ON public.expense_tables FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users can insert own expense tables"
  ON public.expense_tables FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own expense tables"
  ON public.expense_tables FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own expense tables"
  ON public.expense_tables FOR DELETE
  USING (auth.uid() = user_id);

-- RLS for expense_entries
ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own expense entries"
  ON public.expense_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_tables et
      WHERE et.id = expense_table_id AND et.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all expense entries"
  ON public.expense_entries FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Users can insert own expense entries"
  ON public.expense_entries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expense_tables et
      WHERE et.id = expense_table_id AND et.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own expense entries"
  ON public.expense_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_tables et
      WHERE et.id = expense_table_id AND et.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own expense entries"
  ON public.expense_entries FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.expense_tables et
      WHERE et.id = expense_table_id AND et.user_id = auth.uid()
    )
  );

-- Storage bucket for receipts
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  false,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload own receipts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = 'receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Users can view own receipts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = 'receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Users can delete own receipts"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = 'receipts'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "Admins can view all receipts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'expense-receipts'
    AND public.is_admin()
  );
