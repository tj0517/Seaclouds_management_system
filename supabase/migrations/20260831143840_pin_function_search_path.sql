-- Advisor lint 0011 (function_search_path_mutable): pin search_path on every
-- public function that lacked one. Bodies reference objects fully qualified
-- (public.*, auth.uid(); verified via pg_get_functiondef on prod 2026-08-31),
-- so an empty search_path is safe. resubmit_rejected is skipped — it already
-- carries `SET search_path = 'public'` and its body uses unqualified names.
alter function public.handle_new_user() set search_path = '';
alter function public.is_admin() set search_path = '';
alter function public.is_admin_or_pm() set search_path = '';
alter function public.is_pm_for_project(uuid) set search_path = '';
alter function public.is_week_locked(date, uuid) set search_path = '';
alter function public.is_week_locked(date, uuid, uuid) set search_path = '';
alter function public.set_updated_at() set search_path = '';
