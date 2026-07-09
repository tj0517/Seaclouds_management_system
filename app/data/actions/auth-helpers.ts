import { createClient } from '@/utils/supabase/server'

export type UserRoleInfo = {
    role: 'admin' | 'employee' | 'project_lead'
    userId: string
    pmProjectIds: string[] | null // null = all (admin), string[] = scoped (PM)
}

/**
 * Returns the current user's role and, for PMs, the project IDs they're assigned to.
 * For admins, pmProjectIds is null (meaning "all projects").
 * For PMs, pmProjectIds is an array of assigned project IDs.
 * Returns null if no session.
 */
export async function getUserRoleAndProjects(): Promise<UserRoleInfo | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    if (!profile) return null

    const role = profile.role as UserRoleInfo['role']

    if (role === 'admin') {
        return { role, userId: user.id, pmProjectIds: null }
    }

    if (role === 'project_lead') {
        const { data: assignments } = await supabase
            .from('project_assignments')
            .select('project_id')
            .eq('user_id', user.id)

        const pmProjectIds = (assignments ?? []).map((a: any) => a.project_id)
        return { role, userId: user.id, pmProjectIds }
    }

    return { role, userId: user.id, pmProjectIds: [] }
}

/**
 * Check if a PM has access to a specific project.
 * Admins always have access. PMs only if assigned.
 */
export function hasProjectAccess(roleInfo: UserRoleInfo, projectId: string): boolean {
    if (roleInfo.pmProjectIds === null) return true // admin
    return roleInfo.pmProjectIds.includes(projectId)
}

/**
 * Check if user is admin or PM (can access admin panel).
 */
export function isAdminOrPM(role: string): boolean {
    return role === 'admin' || role === 'project_lead'
}
