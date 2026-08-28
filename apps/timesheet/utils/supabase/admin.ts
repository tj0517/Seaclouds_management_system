// SERVER-ONLY: this client uses the service_role key, which bypasses RLS.
// It intentionally lives in the app (not in @scl/db) so the shared package
// never exposes a privileged client. The `server-only` import makes any
// accidental client-side import a build-time error.
import 'server-only'

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from '@scl/db'

let _supabaseAdmin: SupabaseClient<Database> | null = null

export function getSupabaseAdmin() {
    if (!_supabaseAdmin) {
        _supabaseAdmin = createClient<Database>(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
    }
    return _supabaseAdmin
}
