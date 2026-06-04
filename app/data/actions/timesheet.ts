'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { addDays, subDays, format } from 'date-fns'
import { sendAdminNotification } from '@/lib/email'

// 4. Pobierz wpisy z danego tygodnia
export async function getWeeklyEntries(userId: string, startOfWeek: string, endOfWeek: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('timesheet_entries')
        .select('*')
        .eq('user_id', userId)
        .gte('work_date', startOfWeek)
        .lte('work_date', endOfWeek)

    if (error) {
        return []
    }

    return data
}

// 10. Zapisz/Zaktualizuj wpis (Upsert)
export async function saveWorkEntry(projectId: string, date: string, hours: number) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Walidacja
    if (hours < 0 || hours > 24) return { error: 'Invalid number of hours' }

    // Jeśli 0, to usuwamy wpis (żeby nie trzymać śmieci w bazie)
    if (hours === 0) {
        await supabase
            .from('timesheet_entries')
            .delete()
            .match({ user_id: user.id, sub_project_id: projectId, work_date: date })

        return { success: true }
    }

    // W przeciwnym razie UPSERT (Wstaw lub Aktualizuj)
    const { error } = await supabase
        .from('timesheet_entries')
        .upsert(
            {
                user_id: user.id,
                sub_project_id: projectId,
                work_date: date,
                hours: hours
            } as any,
            { onConflict: 'user_id, sub_project_id, work_date' }
        )

    if (error) {
        return { error: error.message }
    }

    return { success: true }
}

export async function submitWeek(weekStart: string, subprojectId: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }


    const { error } = await supabase
        .from('timesheet_submissions')
        .insert({
            user_id: user.id,
            sub_project_id: subprojectId,
            week_start: weekStart,
            status: 'submitted'
        })

    if (error) {
        if (error.code === '23505') {
            return { error: 'This week has already been submitted.' }
        }
        return { error: error.message }
    }

    // Fire-and-forget email notification to admins
    const notifyAdmins = async () => {
        try {
            const { data: profile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('id', user.id)
                .single()

            const { data: subProject } = await supabase
                .from('sub_projects')
                .select('code')
                .eq('id', subprojectId)
                .single()

            await sendAdminNotification({
                employeeName: profile?.full_name ?? 'Unknown',
                subProjectCode: subProject?.code ?? subprojectId,
                weekStart,
            })
        } catch (e) {
            console.error('Failed to send admin notification:', e)
        }
    }
    notifyAdmins()

    revalidatePath('/')
    return { success: true }
}

export async function adminWithdrawSubmission(userId: string, weekStart: string, subprojectId: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Verify caller is admin
    const { data: isAdmin } = await supabase.rpc('is_admin')
    if (!isAdmin) return { error: 'Unauthorized' }

    const { error } = await supabase
        .from('timesheet_submissions')
        .delete()
        .eq('user_id', userId)
        .eq('sub_project_id', subprojectId)
        .eq('week_start', weekStart)

    if (error) {
        return { error: error.message }
    }

    revalidatePath('/admin/reports')
    return { success: true }
}

export async function isWeekSubmitted(weekStart: string, subProjectId: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data, error } = await supabase
        .from('timesheet_submissions')
        .select('id')
        .eq('user_id', user.id)
        .eq('sub_project_id', subProjectId)
        .eq('week_start', weekStart)
        .maybeSingle()

    if (error) {
        return false
    }

    return !!data
}

export type GroupedReportRow = {
    projectName: string
    projectCode: string | null
    subProjectCode: string
    subProjectId: string
    subProjectDescription: string | null
    trackingType: 'hours' | 'days'
    userId: string
    userName: string
    totalHours: number
    dailyBreakdown: Record<string, number> // work_date -> hours
    isSubmitted: boolean
}

export async function getGroupedReportData(
    startDate: string,
    endDate: string,
    filters?: { userName?: string; subProjectCode?: string; projectName?: string }
): Promise<GroupedReportRow[]> {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    // Fetch timesheet entries with full context
    const { data: entries, error } = await supabase
        .from('timesheet_entries')
        .select(`
            id,
            work_date,
            hours,
            user_id,
            sub_project_id,
            profiles:user_id ( full_name ),
            sub_projects:sub_project_id ( code, description, tracking_type, projects:project_id ( name, project_code ) )
        `)
        .gte('work_date', startDate)
        .lte('work_date', endDate)

    if (error || !entries) return []

    // Fetch all submissions in range to know what's been submitted
    const { data: submissions } = await supabase
        .from('timesheet_submissions')
        .select('user_id, sub_project_id, week_start')
        .gte('week_start', startDate)
        .lte('week_start', endDate)

    const submissionSet = new Set(
        (submissions || []).map(s => `${s.user_id}__${s.sub_project_id}__${s.week_start}`)
    )

    // Helper: get Mon of the week for a given date string
    function getWeekStart(dateStr: string): string {
        const d = new Date(dateStr)
        const day = d.getUTCDay() || 7 // 1=Mon..7=Sun
        d.setUTCDate(d.getUTCDate() - day + 1)
        return d.toISOString().slice(0, 10)
    }

    // Group: key = projectName|subProjectCode|userName
    const map = new Map<string, GroupedReportRow>()

    for (const entry of entries) {
        const sp = entry.sub_projects as any
        const project = sp?.projects
        const projectName = project?.name ?? 'Unknown project'
        const projectCode = project?.project_code ?? null
        const subCode = sp?.code ?? '?'
        const subDesc = sp?.description ?? null
        const trackingType = (sp?.tracking_type === 'days' ? 'days' : 'hours') as 'hours' | 'days'
        const userName = (entry.profiles as any)?.full_name ?? 'Unknown user'
        const weekStart = getWeekStart(entry.work_date)
        const key = `${projectName}||${subCode}||${userName}`

        if (!map.has(key)) {
            map.set(key, {
                projectName,
                projectCode,
                subProjectCode: subCode,
                subProjectId: entry.sub_project_id,
                subProjectDescription: subDesc,
                trackingType,
                userId: entry.user_id,
                userName,
                totalHours: 0,
                dailyBreakdown: {},
                isSubmitted: false,
            })
        }

        const row = map.get(key)!
        const hours = entry.hours ?? 0
        row.totalHours += hours
        row.dailyBreakdown[entry.work_date] = (row.dailyBreakdown[entry.work_date] ?? 0) + hours

        // Mark as submitted if ANY week for this user/subproject is submitted
        const isThisWeekSubmitted = submissionSet.has(`${entry.user_id}__${entry.sub_project_id}__${weekStart}`)
        if (isThisWeekSubmitted) row.isSubmitted = true
    }

    let result = Array.from(map.values()).sort((a, b) => {
        if (a.projectName !== b.projectName) return a.projectName.localeCompare(b.projectName)
        if (a.subProjectCode !== b.subProjectCode) return a.subProjectCode.localeCompare(b.subProjectCode)
        return a.userName.localeCompare(b.userName)
    })

    if (filters?.projectName) result = result.filter(r => r.projectName === filters.projectName)
    if (filters?.subProjectCode) result = result.filter(r => r.subProjectCode === filters.subProjectCode)
    if (filters?.userName) result = result.filter(r => r.userName === filters.userName)

    return result
}

export async function getReportFilterOptions(startDate: string, endDate: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { users: [], subProjectCodes: [], projectNames: [] }

    const { data } = await supabase
        .from('timesheet_entries')
        .select(`
            profiles:user_id ( full_name ),
            sub_projects:sub_project_id ( code, projects:project_id ( name ) )
        `)
        .gte('work_date', startDate)
        .lte('work_date', endDate)

    const usersSet = new Set<string>()
    const codesSet = new Set<string>()
    const projectsSet = new Set<string>()

    for (const e of data || []) {
        const sp = e.sub_projects as any
        const fullName = (e.profiles as any)?.full_name
        if (fullName) usersSet.add(fullName)
        if (sp?.code) codesSet.add(sp.code)
        if (sp?.projects?.name) projectsSet.add(sp.projects.name)
    }

    return {
        users: [...usersSet].sort(),
        subProjectCodes: [...codesSet].sort(),
        projectNames: [...projectsSet].sort(),
    }
}

export async function copyWeek(currentWeekStart: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Parse as local date (append T00:00:00 to avoid UTC shift)
    const currentStart = new Date(currentWeekStart + 'T00:00:00')
    const prevStart = subDays(currentStart, 7)
    const prevEnd = addDays(prevStart, 6)

    const prevStartStr = format(prevStart, 'yyyy-MM-dd')
    const prevEndStr = format(prevEnd, 'yyyy-MM-dd')

    // 1. Pobierz wpisy z poprzedniego tygodnia
    const { data: oldEntries } = await supabase
        .from('timesheet_entries')
        .select('*')
        .eq('user_id', user.id)
        .gte('work_date', prevStartStr)
        .lte('work_date', prevEndStr)

    if (!oldEntries || oldEntries.length === 0) {
        return { error: 'No entries in the previous week' }
    }

    // Check which sub-projects are already submitted for the current week
    const subProjectIds = [...new Set(oldEntries.map(e => e.sub_project_id))]
    const { data: submissions } = await supabase
        .from('timesheet_submissions')
        .select('sub_project_id')
        .eq('user_id', user.id)
        .eq('week_start', currentWeekStart)
        .in('sub_project_id', subProjectIds)

    const submittedSet = new Set((submissions || []).map(s => s.sub_project_id))

    const newEntries = oldEntries
        .filter(entry => !submittedSet.has(entry.sub_project_id))
        .map(entry => {
            const oldDate = new Date(entry.work_date + 'T00:00:00')
            const newDate = addDays(oldDate, 7)
            return {
                user_id: user.id,
                sub_project_id: entry.sub_project_id,
                work_date: format(newDate, 'yyyy-MM-dd'),
                hours: entry.hours
            }
        })

    if (newEntries.length === 0) {
        return { error: 'All sub-projects are already submitted for this week' }
    }

    const { error } = await supabase
        .from('timesheet_entries')
        .upsert(newEntries as any, { onConflict: 'user_id, sub_project_id, work_date' })

    if (error) {
        return { error: error.message }
    }

    revalidatePath('/')
    return { success: true }
}
