'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { addDays, subDays, format } from 'date-fns'

type ReportEntry = {
    id: string
    work_date: string
    hours: number
    profiles: { full_name: string | null } | null
    sub_projects: { code: string; description: string | null; projects: { name: string; project_code: string | null } | null } | null
}

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
    if (!user) return { error: 'Brak sesji' }

    // Walidacja
    if (hours < 0 || hours > 24) return { error: 'Nieprawidłowa liczba godzin' }

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
    if (!user) return { error: 'Brak sesji' }


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
            return { error: 'Ten tydzień został już zatwierdzony.' }
        }
        return { error: error.message }
    }

    revalidatePath('/')
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

export async function getReportData(startDate: string, endDate: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
        .from('timesheet_entries')
        .select(`
      id,
      work_date,
      hours,
      profiles:user_id ( full_name ),
      sub_projects:sub_project_id ( code, description, projects:project_id ( name, project_code ) )
    `)
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .order('work_date', { ascending: true })

    if (error) {
        return []
    }

    return data as unknown as ReportEntry[]
}

export type GroupedReportRow = {
    projectName: string
    projectCode: string | null
    subProjectCode: string
    subProjectDescription: string | null
    userName: string
    totalHours: number
    weekBreakdown: Record<string, number> // week_start (Mon) -> hours
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
            sub_projects:sub_project_id ( code, description, projects:project_id ( name, project_code ) )
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
        const projectName = project?.name ?? 'Nieznany projekt'
        const projectCode = project?.project_code ?? null
        const subCode = sp?.code ?? '?'
        const subDesc = sp?.description ?? null
        const userName = (entry.profiles as any)?.full_name ?? 'Nieznany użytkownik'
        const weekStart = getWeekStart(entry.work_date)
        const key = `${projectName}||${subCode}||${userName}`

        if (!map.has(key)) {
            map.set(key, {
                projectName,
                projectCode,
                subProjectCode: subCode,
                subProjectDescription: subDesc,
                userName,
                totalHours: 0,
                weekBreakdown: {},
                isSubmitted: false,
            })
        }

        const row = map.get(key)!
        const hours = entry.hours ?? 0
        row.totalHours += hours
        row.weekBreakdown[weekStart] = (row.weekBreakdown[weekStart] ?? 0) + hours

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
    if (!user) return { error: 'Brak sesji' }

    const currentStart = new Date(currentWeekStart)
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
        return { error: 'Brak wpisów w poprzednim tygodniu' }
    }


    const newEntries = oldEntries.map(entry => {
        const oldDate = new Date(entry.work_date)
        const newDate = addDays(oldDate, 7)
        return {
            user_id: user.id,
            sub_project_id: entry.sub_project_id,
            work_date: format(newDate, 'yyyy-MM-dd'),
            hours: entry.hours
        }
    })


    const { error } = await supabase
        .from('timesheet_entries')
        .insert(newEntries)
        .select() // opcjonalne

    if (error) {
        // Spróbujmy insert z ignoreDuplicates
        const { error: insertError } = await supabase
            .from('timesheet_entries')
            .upsert(newEntries, { onConflict: 'user_id, sub_project_id, work_date', ignoreDuplicates: true })

        if (insertError) {
            return { error: insertError.message }
        }
    }

    revalidatePath('/')
    return { success: true }
}
