export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            profiles: {
                Row: {
                    id: string
                    role: 'admin' | 'worker' | null
                    full_name: string | null
                    email: string | null
                    created_at?: string
                }
                Insert: {
                    id: string
                    role?: 'admin' | 'worker' | null
                    full_name?: string | null
                    email?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    role?: 'admin' | 'worker' | null
                    full_name?: string | null
                    email?: string | null
                    created_at?: string
                }
            }
            projects: {
                Row: {
                    id: string
                    name: string
                    is_active: boolean
                    created_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    is_active?: boolean
                    created_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    is_active?: boolean
                    created_at?: string
                }
            }
            timesheet_entries: {
                Row: {
                    id: string
                    user_id: string
                    project_id: string
                    work_date: string
                    hours: number
                    created_at?: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    project_id: string
                    work_date: string
                    hours: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    project_id?: string
                    work_date?: string
                    hours?: number
                    created_at?: string
                }
            }
            project_assignments: {
                Row: {
                    id: string
                    user_id: string
                    project_id: string
                    created_at?: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    project_id: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    project_id?: string
                    created_at?: string
                }
            }
        }
        Views: {
            [_: string]: {
                Row: {
                    [key: string]: any
                }
            }
        }
        Functions: {
            [_: string]: {
                Args: any
                Returns: any
            }
        }
        Enums: {
            [_: string]: any
        }
    }
}
