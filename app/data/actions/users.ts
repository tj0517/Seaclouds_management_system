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
    const password = formData.get('password') as string
    const full_name = (formData.get('full_name') as string) || null
    const role = ((formData.get('role') as string) || 'employee') as 'admin' | 'employee'
    const employee_id = (formData.get('employee_id') as string) || null
    const position = (formData.get('position') as string) || null
    const rate_hourly = formData.get('rate_hourly') ? Number(formData.get('rate_hourly')) : null
    const rate_daily = formData.get('rate_daily') ? Number(formData.get('rate_daily')) : null

    if (!email) return { error: 'Email is required' }
    if (!password || password.length < 6) return { error: 'Password must be at least 6 characters' }

    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    })

    if (error) return { error: error.message }

    const userId = data.user.id

    const { error: profileError } = await getSupabaseAdmin()
        .from('profiles')
        .upsert({
            id: userId,
            full_name,
            role,
            employee_id,
            position,
            rate_hourly,
            rate_daily,
        } as any, { onConflict: 'id' })

    if (profileError) return { error: profileError.message }

    revalidatePath('/admin/users')
    return { success: true }
}

export async function updateUserProfile(userId: string, data: {
    full_name: string | null
    employee_id: string | null
    position: string | null
    role: 'admin' | 'employee'
    rate_hourly: number | null
    rate_daily: number | null
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { error } = await getSupabaseAdmin()
        .from('profiles')
        .update({
            full_name: data.full_name,
            employee_id: data.employee_id,
            position: data.position,
            role: data.role,
            rate_hourly: data.rate_hourly,
            rate_daily: data.rate_daily,
        } as any)
        .eq('id', userId)

    if (error) return { error: error.message }

    revalidatePath(`/admin/users/${userId}`)
    revalidatePath('/admin/users')
    return { success: true }
}

export async function changePassword(currentPassword: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6) return { error: 'New password must be at least 6 characters' }

    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !user.email) return { error: 'No session' }

    // Verify current password by re-signing in
    const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
    })
    if (signInError) return { error: 'Current password is incorrect' }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { error: error.message }

    return { success: true }
}

export async function changeUserEmail(userId: string, newEmail: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!newEmail || !emailRegex.test(newEmail)) return { error: 'Invalid email format' }

    // Fetch current email to check it's different
    const { data: targetUser, error: fetchError } = await getSupabaseAdmin().auth.admin.getUserById(userId)
    if (fetchError || !targetUser?.user) return { error: fetchError?.message || 'User not found' }
    if (targetUser.user.email === newEmail) return { error: 'New email is the same as current email' }

    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
        email: newEmail,
        email_confirm: true,
    })

    if (error) return { error: error.message }

    revalidatePath(`/admin/users/${userId}`)
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

