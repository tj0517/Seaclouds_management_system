


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."expense_currency" AS ENUM (
    'PLN',
    'EUR',
    'USD',
    'GBP'
);


ALTER TYPE "public"."expense_currency" OWNER TO "postgres";


CREATE TYPE "public"."expense_type" AS ENUM (
    'taxi',
    'lodging',
    'meals',
    'plane_ticket',
    'parking',
    'office_supplies',
    'mileage',
    'other',
    'bus',
    'train'
);


ALTER TYPE "public"."expense_type" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'employee',
    'project_manager'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', 'employee');
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE id = auth.uid() 
    AND role = 'admin'
  );
END;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_or_pm"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'project_manager')
  );
END;
$$;


ALTER FUNCTION "public"."is_admin_or_pm"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_pm_for_project"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles pr
    JOIN public.project_assignments pa ON pa.user_id = pr.id
    WHERE pr.id = auth.uid()
      AND pr.role = 'project_manager'
      AND pa.project_id = p_project_id
  );
END;
$$;


ALTER FUNCTION "public"."is_pm_for_project"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  monday DATE;
BEGIN
  -- Oblicz poniedziałek dla podanej daty (date_trunc zwraca timestamp, więc rzutujemy na date)
  monday := date_trunc('week', entry_date)::DATE;
  
  -- Sprawdź czy istnieje wpis w submissions (submitted lub approved)
  -- Jeśli status to 'rejected', traktujemy tydzień jako odblokowany (można poprawiać)
  RETURN EXISTS (
    SELECT 1 
    FROM public.timesheet_submissions 
    WHERE user_id = entry_user 
      AND week_start = monday 
      AND status IN ('submitted', 'approved')
  );
END;
$$;


ALTER FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid", "entry_sub_project" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  monday DATE;
BEGIN
  monday := date_trunc('week', entry_date)::DATE;
  
  RETURN EXISTS (
    SELECT 1 
    FROM public.timesheet_submissions 
    WHERE user_id = entry_user 
      AND week_start = monday 
      AND sub_project_id = entry_sub_project
      AND status IN ('submitted', 'approved')
  );
END;
$$;


ALTER FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid", "entry_sub_project" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resubmit_rejected"("p_submission_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  BEGIN
    UPDATE timesheet_submissions
    SET status = 'submitted'
    WHERE id = p_submission_id
      AND user_id = p_user_id
      AND status = 'rejected';

    RETURN FOUND;
  END;
$$;


ALTER FUNCTION "public"."resubmit_rejected"("p_submission_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."earnings_month_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "year_month" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."earnings_month_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expense_table_id" "uuid" NOT NULL,
    "expense_date" "date" NOT NULL,
    "expense_date_end" "date",
    "location" "text",
    "expense_type" "public"."expense_type" NOT NULL,
    "description" "text",
    "currency" "public"."expense_currency" DEFAULT 'PLN'::"public"."expense_currency" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "km" numeric(10,2),
    "km_rate" numeric(10,4),
    "receipt_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "exchange_rate" numeric,
    "amount_pln" numeric,
    CONSTRAINT "expense_entries_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."expense_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "work_order" "text",
    "purpose" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "decline_reason" "text"
);


ALTER TABLE "public"."expense_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pdf_exports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "month" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."pdf_exports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "role" "public"."user_role" DEFAULT 'employee'::"public"."user_role",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "employee_id" "text",
    "position" "text",
    "rate_hourly" numeric,
    "rate_daily" numeric
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."project_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "project_code" "text"
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sub_project_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sub_project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sub_project_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sub_projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tracking_type" "text" DEFAULT 'hours'::"text" NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    CONSTRAINT "sub_projects_tracking_type_check" CHECK (("tracking_type" = ANY (ARRAY['hours'::"text", 'days'::"text"])))
);


ALTER TABLE "public"."sub_projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timesheet_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "work_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "hours" numeric DEFAULT 0,
    "sub_project_id" "uuid" NOT NULL
);


ALTER TABLE "public"."timesheet_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timesheet_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "status" "text" DEFAULT 'submitted'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sub_project_id" "uuid" NOT NULL,
    "reject_reason" "text",
    CONSTRAINT "timesheet_submissions_status_check" CHECK (("status" = ANY (ARRAY['submitted'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."timesheet_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_monthly_earnings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "year_month" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'PLN'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_monthly_earnings_amount_check" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."user_monthly_earnings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_contract_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "contract_code" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weekly_contract_codes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."earnings_month_status"
    ADD CONSTRAINT "earnings_month_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."earnings_month_status"
    ADD CONSTRAINT "earnings_month_status_user_id_year_month_key" UNIQUE ("user_id", "year_month");



ALTER TABLE ONLY "public"."expense_entries"
    ADD CONSTRAINT "expense_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_tables"
    ADD CONSTRAINT "expense_tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pdf_exports"
    ADD CONSTRAINT "pdf_exports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pdf_exports"
    ADD CONSTRAINT "pdf_exports_user_id_month_key" UNIQUE ("user_id", "month");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_employee_id_key" UNIQUE ("employee_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_assignments"
    ADD CONSTRAINT "project_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_assignments"
    ADD CONSTRAINT "project_assignments_project_id_user_id_key" UNIQUE ("project_id", "user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sub_project_assignments"
    ADD CONSTRAINT "sub_project_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sub_project_assignments"
    ADD CONSTRAINT "sub_project_assignments_sub_project_id_user_id_key" UNIQUE ("sub_project_id", "user_id");



ALTER TABLE ONLY "public"."sub_projects"
    ADD CONSTRAINT "sub_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sub_projects"
    ADD CONSTRAINT "sub_projects_project_id_code_key" UNIQUE ("project_id", "code");



ALTER TABLE ONLY "public"."timesheet_entries"
    ADD CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timesheet_submissions"
    ADD CONSTRAINT "timesheet_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "unique_project_code" UNIQUE ("project_code");



ALTER TABLE ONLY "public"."timesheet_submissions"
    ADD CONSTRAINT "unique_submission_per_subproject_week" UNIQUE ("user_id", "week_start", "sub_project_id");



ALTER TABLE ONLY "public"."user_monthly_earnings"
    ADD CONSTRAINT "user_monthly_earnings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_contract_codes"
    ADD CONSTRAINT "weekly_contract_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_contract_codes"
    ADD CONSTRAINT "weekly_contract_codes_user_id_project_id_week_start_key" UNIQUE ("user_id", "project_id", "week_start");



CREATE INDEX "idx_earnings_user_id" ON "public"."user_monthly_earnings" USING "btree" ("user_id");



CREATE INDEX "idx_earnings_year_month" ON "public"."user_monthly_earnings" USING "btree" ("year_month");



CREATE INDEX "idx_expense_entries_date" ON "public"."expense_entries" USING "btree" ("expense_date");



CREATE INDEX "idx_expense_entries_table_id" ON "public"."expense_entries" USING "btree" ("expense_table_id");



CREATE INDEX "idx_expense_tables_project_id" ON "public"."expense_tables" USING "btree" ("project_id");



CREATE INDEX "idx_expense_tables_user_id" ON "public"."expense_tables" USING "btree" ("user_id");



CREATE UNIQUE INDEX "unique_timesheet_entries_sub_project" ON "public"."timesheet_entries" USING "btree" ("user_id", "sub_project_id", "work_date");



CREATE UNIQUE INDEX "uq_earnings_user_month_no_project" ON "public"."user_monthly_earnings" USING "btree" ("user_id", "year_month") WHERE ("project_id" IS NULL);



CREATE UNIQUE INDEX "uq_earnings_user_month_with_project" ON "public"."user_monthly_earnings" USING "btree" ("user_id", "year_month", "project_id") WHERE ("project_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_earnings_updated_at" BEFORE UPDATE ON "public"."user_monthly_earnings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."earnings_month_status"
    ADD CONSTRAINT "earnings_month_status_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."earnings_month_status"
    ADD CONSTRAINT "earnings_month_status_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_entries"
    ADD CONSTRAINT "expense_entries_expense_table_id_fkey" FOREIGN KEY ("expense_table_id") REFERENCES "public"."expense_tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_tables"
    ADD CONSTRAINT "expense_tables_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_tables"
    ADD CONSTRAINT "expense_tables_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."expense_tables"
    ADD CONSTRAINT "expense_tables_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pdf_exports"
    ADD CONSTRAINT "pdf_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_assignments"
    ADD CONSTRAINT "project_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_assignments"
    ADD CONSTRAINT "project_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sub_project_assignments"
    ADD CONSTRAINT "sub_project_assignments_sub_project_id_fkey" FOREIGN KEY ("sub_project_id") REFERENCES "public"."sub_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sub_project_assignments"
    ADD CONSTRAINT "sub_project_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sub_projects"
    ADD CONSTRAINT "sub_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timesheet_entries"
    ADD CONSTRAINT "timesheet_entries_sub_project_id_fkey" FOREIGN KEY ("sub_project_id") REFERENCES "public"."sub_projects"("id");



ALTER TABLE ONLY "public"."timesheet_entries"
    ADD CONSTRAINT "timesheet_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."timesheet_submissions"
    ADD CONSTRAINT "timesheet_submissions_sub_project_id_fkey" FOREIGN KEY ("sub_project_id") REFERENCES "public"."sub_projects"("id");



ALTER TABLE ONLY "public"."timesheet_submissions"
    ADD CONSTRAINT "timesheet_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_monthly_earnings"
    ADD CONSTRAINT "user_monthly_earnings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_monthly_earnings"
    ADD CONSTRAINT "user_monthly_earnings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_monthly_earnings"
    ADD CONSTRAINT "user_monthly_earnings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_contract_codes"
    ADD CONSTRAINT "weekly_contract_codes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_contract_codes"
    ADD CONSTRAINT "weekly_contract_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Admin usuwa przypisania" ON "public"."project_assignments" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Admin zarządza kodami" ON "public"."sub_projects" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin zarządza projektami" ON "public"."projects" USING ("public"."is_admin"());



CREATE POLICY "Admin zarządza statusami" ON "public"."timesheet_submissions" USING ("public"."is_admin"());



CREATE POLICY "Admin zmienia przypisania" ON "public"."project_assignments" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can delete earnings" ON "public"."user_monthly_earnings" FOR DELETE USING ("public"."is_admin"());



CREATE POLICY "Admins can insert earnings" ON "public"."user_monthly_earnings" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage earnings_month_status" ON "public"."earnings_month_status" USING ("public"."is_admin"());



CREATE POLICY "Admins can manage sub_project_assignments" ON "public"."sub_project_assignments" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can read all exports" ON "public"."pdf_exports" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can select earnings" ON "public"."user_monthly_earnings" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can update all expense tables" ON "public"."expense_tables" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Admins can update earnings" ON "public"."user_monthly_earnings" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Admins can update profiles" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "profiles_1"."role"
   FROM "public"."profiles" "profiles_1"
  WHERE ("profiles_1"."id" = "auth"."uid"())) = 'admin'::"public"."user_role"));



CREATE POLICY "Admins can view all expense entries" ON "public"."expense_entries" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view all expense tables" ON "public"."expense_tables" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins read all" ON "public"."weekly_contract_codes" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Bezpieczny dostęp do profili" ON "public"."profiles" FOR SELECT USING ((("auth"."uid"() = "id") OR "public"."is_admin"()));



CREATE POLICY "Pracownik cofa zatwierdzenie" ON "public"."timesheet_submissions" FOR DELETE USING ((("auth"."uid"() = "user_id") AND ("status" = 'submitted'::"text")));



CREATE POLICY "Pracownik dodaje godziny (jeśli niezablokowane)" ON "public"."timesheet_entries" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (NOT "public"."is_week_locked"("work_date", "auth"."uid"()))));



CREATE POLICY "Pracownik dodaje godziny (jeśli podprojekt niezablokowany)" ON "public"."timesheet_entries" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") AND (NOT "public"."is_week_locked"("work_date", "auth"."uid"(), "sub_project_id"))));



CREATE POLICY "Pracownik edytuje godziny (jeśli niezablokowane)" ON "public"."timesheet_entries" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND (NOT "public"."is_week_locked"("work_date", "auth"."uid"())))) WITH CHECK ((("auth"."uid"() = "user_id") AND (NOT "public"."is_week_locked"("work_date", "auth"."uid"()))));



CREATE POLICY "Pracownik edytuje godziny (jeśli podprojekt niezablokowany)" ON "public"."timesheet_entries" FOR UPDATE USING ((("auth"."uid"() = "user_id") AND (NOT "public"."is_week_locked"("work_date", "auth"."uid"(), "sub_project_id"))));



CREATE POLICY "Pracownik może zatwierdzić tydzień" ON "public"."timesheet_submissions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Pracownik usuwa godziny (jeśli niezablokowane)" ON "public"."timesheet_entries" FOR DELETE USING ((("auth"."uid"() = "user_id") AND (NOT "public"."is_week_locked"("work_date", "auth"."uid"()))));



CREATE POLICY "Pracownik usuwa godziny (jeśli podprojekt niezablokowany)" ON "public"."timesheet_entries" FOR DELETE USING ((("auth"."uid"() = "user_id") AND (NOT "public"."is_week_locked"("work_date", "auth"."uid"(), "sub_project_id"))));



CREATE POLICY "Pracownik widzi swoje statusy" ON "public"."timesheet_submissions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own expense entries" ON "public"."expense_entries" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."expense_tables" "et"
  WHERE (("et"."id" = "expense_entries"."expense_table_id") AND ("et"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete own expense tables" ON "public"."expense_tables" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own expense entries" ON "public"."expense_entries" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."expense_tables" "et"
  WHERE (("et"."id" = "expense_entries"."expense_table_id") AND ("et"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert own expense tables" ON "public"."expense_tables" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own exports" ON "public"."pdf_exports" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own expense entries" ON "public"."expense_entries" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."expense_tables" "et"
  WHERE (("et"."id" = "expense_entries"."expense_table_id") AND ("et"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update own expense tables" ON "public"."expense_tables" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own expense entries" ON "public"."expense_entries" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."expense_tables" "et"
  WHERE (("et"."id" = "expense_entries"."expense_table_id") AND ("et"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own expense tables" ON "public"."expense_tables" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own sub_project_assignments" ON "public"."sub_project_assignments" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own contract codes" ON "public"."weekly_contract_codes" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Użytkownicy edytują swoje dane" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Widoczność kodów" ON "public"."sub_projects" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Widoczność projektów" ON "public"."projects" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Widoczność przypisań" ON "public"."project_assignments" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "Widoczność wpisów" ON "public"."timesheet_entries" FOR SELECT USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role"))))));



ALTER TABLE "public"."earnings_month_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense_tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pdf_exports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sub_project_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sub_projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timesheet_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timesheet_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_monthly_earnings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_contract_codes" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_or_pm"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_or_pm"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_or_pm"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_pm_for_project"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_pm_for_project"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_pm_for_project"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid", "entry_sub_project" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid", "entry_sub_project" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_week_locked"("entry_date" "date", "entry_user" "uuid", "entry_sub_project" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."resubmit_rejected"("p_submission_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resubmit_rejected"("p_submission_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resubmit_rejected"("p_submission_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."earnings_month_status" TO "anon";
GRANT ALL ON TABLE "public"."earnings_month_status" TO "authenticated";
GRANT ALL ON TABLE "public"."earnings_month_status" TO "service_role";



GRANT ALL ON TABLE "public"."expense_entries" TO "anon";
GRANT ALL ON TABLE "public"."expense_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_entries" TO "service_role";



GRANT ALL ON TABLE "public"."expense_tables" TO "anon";
GRANT ALL ON TABLE "public"."expense_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_tables" TO "service_role";



GRANT ALL ON TABLE "public"."pdf_exports" TO "anon";
GRANT ALL ON TABLE "public"."pdf_exports" TO "authenticated";
GRANT ALL ON TABLE "public"."pdf_exports" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_assignments" TO "anon";
GRANT ALL ON TABLE "public"."project_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."project_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."sub_project_assignments" TO "anon";
GRANT ALL ON TABLE "public"."sub_project_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."sub_project_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."sub_projects" TO "anon";
GRANT ALL ON TABLE "public"."sub_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."sub_projects" TO "service_role";



GRANT ALL ON TABLE "public"."timesheet_entries" TO "anon";
GRANT ALL ON TABLE "public"."timesheet_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."timesheet_entries" TO "service_role";



GRANT ALL ON TABLE "public"."timesheet_submissions" TO "anon";
GRANT ALL ON TABLE "public"."timesheet_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."timesheet_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."user_monthly_earnings" TO "anon";
GRANT ALL ON TABLE "public"."user_monthly_earnings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_monthly_earnings" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_contract_codes" TO "anon";
GRANT ALL ON TABLE "public"."weekly_contract_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_contract_codes" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































-- Trigger on auth.users exists on prod but is outside the "public" schema dump,
-- so pg_dump omits it; re-declared here to keep the baseline faithful.
CREATE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();

-- Local dev images auto-enable pg_net; prod does not have it. Dropped so the
-- schema produced by this baseline matches prod exactly.
DROP EXTENSION IF EXISTS "pg_net";

-- Storage RLS policies exist on prod but live in the "storage" schema, which
-- the public-schema dump omits; re-declared here to keep the baseline faithful.
CREATE POLICY "Admins can read all export files" ON "storage"."objects"
  FOR SELECT TO "public"
  USING ((("bucket_id" = 'timesheet-exports'::"text") AND "public"."is_admin"()));

CREATE POLICY "Admins can view all receipts" ON "storage"."objects"
  FOR SELECT TO "public"
  USING ((("bucket_id" = 'expense-receipts'::"text") AND "public"."is_admin"()));

CREATE POLICY "Users can delete own receipts" ON "storage"."objects"
  FOR DELETE TO "public"
  USING ((("bucket_id" = 'expense-receipts'::"text") AND (("storage"."foldername"("name"))[1] = 'receipts'::"text") AND (("storage"."foldername"("name"))[2] = ("auth"."uid"())::"text")));

CREATE POLICY "Users can read own export files" ON "storage"."objects"
  FOR SELECT TO "public"
  USING ((("bucket_id" = 'timesheet-exports'::"text") AND (("storage"."foldername"("name"))[1] = 'exports'::"text") AND (("storage"."foldername"("name"))[2] = ("auth"."uid"())::"text")));

CREATE POLICY "Users can upload own receipts" ON "storage"."objects"
  FOR INSERT TO "public"
  WITH CHECK ((("bucket_id" = 'expense-receipts'::"text") AND (("storage"."foldername"("name"))[1] = 'receipts'::"text") AND (("storage"."foldername"("name"))[2] = ("auth"."uid"())::"text")));

CREATE POLICY "Users can view own receipts" ON "storage"."objects"
  FOR SELECT TO "public"
  USING ((("bucket_id" = 'expense-receipts'::"text") AND (("storage"."foldername"("name"))[1] = 'receipts'::"text") AND (("storage"."foldername"("name"))[2] = ("auth"."uid"())::"text")));
