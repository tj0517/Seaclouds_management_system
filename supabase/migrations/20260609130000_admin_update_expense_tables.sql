-- Allow admins to update any expense table (for approve/decline)
CREATE POLICY "Admins can update all expense tables"
  ON public.expense_tables FOR UPDATE
  USING (public.is_admin());
