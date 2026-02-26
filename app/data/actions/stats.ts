'use server'

import { createClient } from '@/utils/supabase/server'
import { format, startOfMonth, endOfMonth } from 'date-fns'

// 5. Pobierz statystyki na dashboard
export async function getAdminStats() {
    const supabase = await createClient()

    const today = new Date()
    const monthStart = format(startOfMonth(today), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd')

    const [projects, users, monthlyEntries, monthlySubmissions] = await Promise.all([
        supabase.from('projects').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase
            .from('timesheet_entries')
            .select('hours, sub_projects:sub_project_id ( projects:project_id ( name ) )')
            .gte('work_date', monthStart)
            .lte('work_date', monthEnd),
        supabase
            .from('timesheet_submissions')
            .select('*', { count: 'exact', head: true })
            .gte('week_start', monthStart)
            .lte('week_start', monthEnd),
    ])

    const entries = monthlyEntries.data || []

    const totalHoursThisMonth = entries.reduce((sum, e) => sum + (e.hours || 0), 0)

    // Aggregate hours per project
    const projectMap = new Map<string, number>()
    for (const entry of entries) {
        const name = (entry.sub_projects as any)?.projects?.name || 'Nieznany projekt'
        projectMap.set(name, (projectMap.get(name) || 0) + (entry.hours || 0))
    }
    const hoursPerProject = Array.from(projectMap.entries())
        .map(([name, hours]) => ({ name, hours }))
        .sort((a, b) => b.hours - a.hours)

    return {
        projectsCount: projects.count || 0,
        usersCount: users.count || 0,
        totalHoursThisMonth,
        totalSubmissionsThisMonth: monthlySubmissions.count || 0,
        hoursPerProject,
    }
}
