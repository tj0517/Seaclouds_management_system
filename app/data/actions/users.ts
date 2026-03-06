'use server'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { revalidatePath } from 'next/cache'
import { Database } from '@/utils/supabase/types'

type Profile = Database['public']['Tables']['profiles']['Row']

// 1. Pobierz profil zalogowanego użytkownika (i sprawdź rolę)
export async function getUserProfile(): Promise<{ user: any, profile: Profile | null } | null> {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // Używamy naszej bezpiecznej funkcji is_admin() lub polityk RLS
    const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    // Explicit cast to fix "never" type inference issue
    const profile = data as Profile | null

    return { user, profile }
}

// 6. Pobierz listę wszystkich pracowników
export async function getUsers(): Promise<Profile[]> {
    const supabase = await createClient()

    const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true }) // lub email

    return data as Profile[] || []
}

// 9. Pobierz projekty przypisane do usera (z nazwami)
export async function getMyProjects() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    // Krok 1: Pobierz ID przypisanych projektów
    const { data: assignments } = await supabase
        .from('project_assignments')
        .select('project_id')
        .eq('user_id', user.id)

    const projectIds = (assignments as any)?.map((a: any) => a.project_id) || []

    if (projectIds.length === 0) return []

    // Krok 2: Pobierz szczegóły tych projektów
    const { data: projects } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds)
        .eq('is_active', true)
        .order('name')

    return projects || []
}

// 11. Zmień rolę użytkownika
// 11. Zmień rolę użytkownika
export async function updateUserRole(userId: string, newRole: 'admin' | 'employee') {
    const supabase = await createClient()

    // Opcjonalnie: Sprawdź, czy wykonujący to admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Tutaj zakładamy, że tylko admin może wywołać tę funkcję (RLS w bazie też powinno to blokować)

    const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId)

    if (error) {
        return { error: error.message }
    }

    revalidatePath(`/admin/users/${userId}`)
    return { success: true }
}

export async function inviteUser(formData: FormData) {
    const email = formData.get('email') as string
    const full_name = (formData.get('full_name') as string) || null
    const role = ((formData.get('role') as string) || 'employee') as 'admin' | 'employee'

    if (!email) return { error: 'Email is required' }

    const { data, error } = await getSupabaseAdmin().auth.admin.inviteUserByEmail(email)

    if (error) return { error: error.message }

    const userId = data.user.id

    const { error: profileError } = await getSupabaseAdmin()
        .from('profiles')
        .insert({ id: userId, full_name, role })

    if (profileError) return { error: profileError.message }

    revalidatePath('/admin/users')
    return { success: true }
}

export async function deactivateUser(userId: string) {
    try {
        // Use admin client to bypass RLS
        const { error } = await getSupabaseAdmin()
            .from('project_assignments')
            .delete()
            .eq('user_id', userId)

        if (error) {
            return { error: error.message }
        }

        revalidatePath(`/admin/users/${userId}`)
        revalidatePath('/admin/users')
        return { success: true }
    } catch (e: any) {
        return { error: e.message || 'Unknown error' }
    }
}

