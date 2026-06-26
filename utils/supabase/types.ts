export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      expense_entries: {
        Row: {
          amount: number
          amount_pln: number | null
          created_at: string
          currency: Database["public"]["Enums"]["expense_currency"]
          description: string | null
          exchange_rate: number | null
          expense_date: string
          expense_date_end: string | null
          expense_table_id: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          id: string
          km: number | null
          km_rate: number | null
          location: string | null
          receipt_path: string | null
        }
        Insert: {
          amount: number
          amount_pln?: number | null
          created_at?: string
          currency?: Database["public"]["Enums"]["expense_currency"]
          description?: string | null
          exchange_rate?: number | null
          expense_date: string
          expense_date_end?: string | null
          expense_table_id: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          id?: string
          km?: number | null
          km_rate?: number | null
          location?: string | null
          receipt_path?: string | null
        }
        Update: {
          amount?: number
          amount_pln?: number | null
          created_at?: string
          currency?: Database["public"]["Enums"]["expense_currency"]
          description?: string | null
          exchange_rate?: number | null
          expense_date?: string
          expense_date_end?: string | null
          expense_table_id?: string
          expense_type?: Database["public"]["Enums"]["expense_type"]
          id?: string
          km?: number | null
          km_rate?: number | null
          location?: string | null
          receipt_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_entries_expense_table_id_fkey"
            columns: ["expense_table_id"]
            isOneToOne: false
            referencedRelation: "expense_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_tables: {
        Row: {
          created_at: string
          decline_reason: string | null
          end_date: string | null
          id: string
          project_id: string
          purpose: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string
          user_id: string
          work_order: string | null
        }
        Insert: {
          created_at?: string
          decline_reason?: string | null
          end_date?: string | null
          id?: string
          project_id: string
          purpose?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string
          user_id: string
          work_order?: string | null
        }
        Update: {
          created_at?: string
          decline_reason?: string | null
          end_date?: string | null
          id?: string
          project_id?: string
          purpose?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string
          user_id?: string
          work_order?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_tables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_tables_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_exports: {
        Row: {
          created_at: string | null
          id: string
          month: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          month: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          month?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdf_exports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          employee_id: string | null
          full_name: string | null
          id: string
          position: string | null
          rate_daily: number | null
          rate_hourly: number | null
          role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          full_name?: string | null
          id: string
          position?: string | null
          rate_daily?: number | null
          rate_hourly?: number | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          full_name?: string | null
          id?: string
          position?: string | null
          rate_daily?: number | null
          rate_hourly?: number | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: []
      }
      project_assignments: {
        Row: {
          assigned_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          project_code: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          project_code?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          project_code?: string | null
        }
        Relationships: []
      }
      sub_project_assignments: {
        Row: {
          assigned_at: string | null
          id: string
          sub_project_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          id?: string
          sub_project_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          id?: string
          sub_project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_project_assignments_sub_project_id_fkey"
            columns: ["sub_project_id"]
            isOneToOne: false
            referencedRelation: "sub_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_project_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_projects: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_deleted: boolean
          project_id: string
          tracking_type: string
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_deleted?: boolean
          project_id: string
          tracking_type?: string
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_deleted?: boolean
          project_id?: string
          tracking_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_entries: {
        Row: {
          created_at: string
          hours: number | null
          id: string
          sub_project_id: string
          user_id: string
          work_date: string
        }
        Insert: {
          created_at?: string
          hours?: number | null
          id?: string
          sub_project_id: string
          user_id?: string
          work_date: string
        }
        Update: {
          created_at?: string
          hours?: number | null
          id?: string
          sub_project_id?: string
          user_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_sub_project_id_fkey"
            columns: ["sub_project_id"]
            isOneToOne: false
            referencedRelation: "sub_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_submissions: {
        Row: {
          created_at: string | null
          id: string
          reject_reason: string | null
          status: string
          sub_project_id: string
          user_id: string
          week_start: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          reject_reason?: string | null
          status?: string
          sub_project_id: string
          user_id: string
          week_start: string
        }
        Update: {
          created_at?: string | null
          id?: string
          reject_reason?: string | null
          status?: string
          sub_project_id?: string
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_submissions_sub_project_id_fkey"
            columns: ["sub_project_id"]
            isOneToOne: false
            referencedRelation: "sub_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_monthly_earnings: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          currency: string
          id: string
          notes: string | null
          project_id: string | null
          updated_at: string
          user_id: string
          year_month: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          updated_at?: string
          user_id: string
          year_month: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          updated_at?: string
          user_id?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_monthly_earnings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_monthly_earnings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_monthly_earnings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_contract_codes: {
        Row: {
          contract_code: string
          id: string
          project_id: string
          updated_at: string | null
          user_id: string
          week_start: string
        }
        Insert: {
          contract_code?: string
          id?: string
          project_id: string
          updated_at?: string | null
          user_id: string
          week_start: string
        }
        Update: {
          contract_code?: string
          id?: string
          project_id?: string
          updated_at?: string | null
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_contract_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      is_week_locked:
        | { Args: { entry_date: string; entry_user: string }; Returns: boolean }
        | {
            Args: {
              entry_date: string
              entry_sub_project: string
              entry_user: string
            }
            Returns: boolean
          }
    }
    Enums: {
      expense_currency: "PLN" | "EUR" | "USD" | "GBP"
      expense_type:
        | "taxi"
        | "lodging"
        | "meals"
        | "plane_ticket"
        | "parking"
        | "office_supplies"
        | "mileage"
        | "other"
        | "bus"
        | "train"
      user_role: "admin" | "employee"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      expense_currency: ["PLN", "EUR", "USD", "GBP"],
      expense_type: [
        "taxi",
        "lodging",
        "meals",
        "plane_ticket",
        "parking",
        "office_supplies",
        "mileage",
        "other",
        "bus",
        "train",
      ],
      user_role: ["admin", "employee"],
    },
  },
} as const
