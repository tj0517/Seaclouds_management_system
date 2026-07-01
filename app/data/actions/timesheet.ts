'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'
import { addDays, subDays, format } from 'date-fns'
import { sendAdminNotification, sendTimesheetWithdrawNotification } from '@/lib/email'
import { getSupabaseAdmin } from '@/utils/supabase/admin'

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

    // Check for existing rejected row — update instead of insert
    const { data: existing } = await supabase
        .from('timesheet_submissions')
        .select('id, status')
        .eq('user_id', user.id)
        .eq('sub_project_id', subprojectId)
        .eq('week_start', weekStart)
        .maybeSingle()

    if (existing?.status === 'submitted') {
        return { error: 'This week has already been submitted.' }
    }

    if (existing) {
        // Resubmit a rejected row
        const { error } = await supabase
            .from('timesheet_submissions')
            .update({ status: 'submitted', reject_reason: null } as any)
            .eq('id', existing.id)

        if (error) return { error: error.message }
    } else {
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
    }

    // Email notification to admins
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

    revalidatePath('/')
    return { success: true }
}

export async function submitWeekAll(weekStart: string, subprojectIds: string[]) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Check which already exist
    const { data: existing } = await supabase
        .from('timesheet_submissions')
        .select('sub_project_id, status')
        .eq('user_id', user.id)
        .eq('week_start', weekStart)
        .in('sub_project_id', subprojectIds)

    const existingMap = new Map((existing ?? []).map(e => [e.sub_project_id, e.status]))
    const alreadySubmitted = new Set(
        (existing ?? []).filter(e => e.status === 'submitted').map(e => e.sub_project_id)
    )
    const rejectedIds = subprojectIds.filter(id => existingMap.get(id) === 'rejected')
    const toInsert = subprojectIds.filter(id => !existingMap.has(id))
    const toSubmit = [...rejectedIds, ...toInsert]

    if (toSubmit.length === 0) {
        return { error: 'All projects are already submitted.' }
    }

    // Update rejected rows back to submitted
    if (rejectedIds.length > 0) {
        const { error } = await supabase
            .from('timesheet_submissions')
            .update({ status: 'submitted', reject_reason: null } as any)
            .eq('user_id', user.id)
            .eq('week_start', weekStart)
            .in('sub_project_id', rejectedIds)

        if (error) return { error: error.message }
    }

    // Insert truly new rows
    if (toInsert.length > 0) {
        const rows = toInsert.map(subprojectId => ({
            user_id: user.id,
            sub_project_id: subprojectId,
            week_start: weekStart,
            status: 'submitted' as const,
        }))

        const { error } = await supabase
            .from('timesheet_submissions')
            .insert(rows as any)

        if (error) return { error: error.message }
    }

    // Email notification to admins
    try {
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single()

        const { data: subProjectData } = await supabase
            .from('sub_projects')
            .select('code')
            .in('id', toSubmit)

        const codes = subProjectData?.map(sp => sp.code).join(', ') ?? 'multiple projects'

        await sendAdminNotification({
            employeeName: profile?.full_name ?? 'Unknown',
            subProjectCode: codes,
            weekStart,
        })
    } catch (e) {
        console.error('Failed to send admin notification:', e)
    }

    revalidatePath('/')
    return { success: true, submitted: toSubmit }
}

export async function adminWithdrawSubmission(userId: string, weekStart: string, subprojectId: string, reason: string) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Verify caller is admin
    const { data: isAdmin } = await supabase.rpc('is_admin')
    if (!isAdmin) return { error: 'Unauthorized' }

    const { error } = await supabase
        .from('timesheet_submissions')
        .update({ status: 'rejected', reject_reason: reason } as any)
        .eq('user_id', userId)
        .eq('sub_project_id', subprojectId)
        .eq('week_start', weekStart)

    if (error) {
        return { error: error.message }
    }

    // Send rejection notification email to employee
    try {
        const adminClient = getSupabaseAdmin()
        const { data: authUser } = await adminClient.auth.admin.getUserById(userId)
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', userId)
            .single()
        const { data: subProject } = await supabase
            .from('sub_projects')
            .select('code')
            .eq('id', subprojectId)
            .single()

        if (authUser?.user?.email) {
            await sendTimesheetWithdrawNotification({
                employeeEmail: authUser.user.email,
                employeeName: profile?.full_name ?? 'Employee',
                subProjectCode: subProject?.code ?? 'Unknown',
                weekStart,
                reason,
            })
        }
    } catch {
        // Don't fail the rejection if email fails
    }

    revalidatePath('/admin/reports')
    return { success: true }
}

export async function isWeekSubmitted(weekStart: string, subProjectId: string): Promise<{ status: string; rejectReason: string | null } | null> {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
        .from('timesheet_submissions')
        .select('status, reject_reason')
        .eq('user_id', user.id)
        .eq('sub_project_id', subProjectId)
        .eq('week_start', weekStart)
        .maybeSingle()

    if (error || !data) {
        return null
    }

    return { status: data.status, rejectReason: data.reject_reason ?? null }
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
    rateHourly: number | null
    rateDaily: number | null
    earnings: number // calculated: totalHours * rate
    contractCodes: Record<string, string> // weekStart -> contract_code
}

export async function getGroupedReportData(
    startDate: string,
    endDate: string,
    filters?: { userName?: string; subProjectCode?: string; projectName?: string; userId?: string },
    supabaseClient?: any
): Promise<GroupedReportRow[]> {
    const supabase = supabaseClient ?? await createClient()

    if (!supabaseClient) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return []
    }

    // Fetch timesheet entries with sub_projects (no profiles join — FK goes to auth.users, not profiles)
    let query = supabase
        .from('timesheet_entries')
        .select(`
            id,
            work_date,
            hours,
            user_id,
            sub_project_id,
            sub_projects ( code, description, tracking_type, projects ( name, project_code ) )
        `)
        .gte('work_date', startDate)
        .lte('work_date', endDate)

    if (filters?.userId) {
        query = query.eq('user_id', filters.userId)
    }

    const { data: entries, error } = await query

    if (error) {
        console.error('[getGroupedReportData] query error:', error)
        return []
    }
    if (!entries) return []

    // Fetch profiles separately (no FK from timesheet_entries to profiles)
    const userIds = [...new Set(entries.map((e: any) => e.user_id))]
    const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, full_name, rate_hourly, rate_daily')
        .in('id', userIds)
    const profileMap = new Map<string, { id: string; full_name: string | null; rate_hourly: number | null; rate_daily: number | null }>(
        (profileRows || []).map((p: any) => [p.id, p])
    )

    // Fetch all submissions in range to know what's been submitted (only count 'submitted' status)
    const { data: submissions } = await supabase
        .from('timesheet_submissions')
        .select('user_id, sub_project_id, week_start')
        .eq('status', 'submitted')
        .gte('week_start', startDate)
        .lte('week_start', endDate)

    const submissionSet = new Set(
        (submissions || []).map((s: any) => `${s.user_id}__${s.sub_project_id}__${s.week_start}`)
    )

    // Fetch contract codes for the date range
    const { data: contractCodesData } = await supabase
        .from('weekly_contract_codes')
        .select('user_id, project_id, week_start, contract_code')
        .gte('week_start', startDate)
        .lte('week_start', endDate)

    // Map: userId__projectId__weekStart -> contract_code
    const contractCodeMap = new Map<string, string>()
    for (const cc of contractCodesData || []) {
        contractCodeMap.set(`${cc.user_id}__${cc.project_id}__${cc.week_start}`, cc.contract_code)
    }

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
        const profile = profileMap.get(entry.user_id)
        const userName = profile?.full_name ?? 'Unknown user'
        const rateHourly = profile?.rate_hourly ?? null
        const rateDaily = profile?.rate_daily ?? null
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
                rateHourly,
                rateDaily,
                earnings: 0,
                contractCodes: {},
            })
        }

        const row = map.get(key)!
        const hours = entry.hours ?? 0
        row.totalHours += hours
        row.dailyBreakdown[entry.work_date] = (row.dailyBreakdown[entry.work_date] ?? 0) + hours
        // Calculate earnings based on tracking type and rate
        const rate = trackingType === 'days' ? rateDaily : rateHourly
        if (rate) row.earnings += hours * rate

        // Look up contract code for this user/project/week
        const projectId = project?.id
        if (projectId && !row.contractCodes[weekStart]) {
            const cc = contractCodeMap.get(`${entry.user_id}__${projectId}__${weekStart}`)
            if (cc) row.contractCodes[weekStart] = cc
        }

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
            user_id,
            sub_projects ( code, projects ( name ) )
        `)
        .gte('work_date', startDate)
        .lte('work_date', endDate)

    // Fetch profiles separately
    const userIds = [...new Set((data || []).map((e: any) => e.user_id))]
    const { data: profileRows } = userIds.length > 0
        ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
        : { data: [] }
    const profileMap = new Map(
        (profileRows || []).map((p: any) => [p.id, p])
    )

    const usersSet = new Set<string>()
    const codesSet = new Set<string>()
    const projectsSet = new Set<string>()

    for (const e of data || []) {
        const sp = e.sub_projects as any
        const fullName = profileMap.get((e as any).user_id)?.full_name
        if (fullName) usersSet.add(fullName)
        if (sp?.code) codesSet.add(sp.code)
        if (sp?.projects?.name) projectsSet.add(sp.projects.name)
    }

    // Fetch unique service order codes in the date range
    const { data: contractRows } = await supabase
        .from('weekly_contract_codes')
        .select('contract_code')
        .gte('week_start', startDate)
        .lte('week_start', endDate)

    const serviceOrdersSet = new Set<string>()
    for (const row of contractRows || []) {
        if (row.contract_code) serviceOrdersSet.add(row.contract_code)
    }

    return {
        users: [...usersSet].sort(),
        subProjectCodes: [...codesSet].sort(),
        projectNames: [...projectsSet].sort(),
        serviceOrders: [...serviceOrdersSet].sort(),
    }
}

// Contract codes per project per week
export async function getWeeklyContractCodes(userId: string, weekStart: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('weekly_contract_codes')
        .select('project_id, contract_code')
        .eq('user_id', userId)
        .eq('week_start', weekStart)

    if (error) return {}

    const result: Record<string, string> = {}
    for (const row of data || []) {
        result[row.project_id] = row.contract_code
    }
    return result
}

export async function saveContractCode(projectId: string, weekStart: string, code: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    if (code.trim() === '') {
        // Delete instead of storing empty string
        await supabase
            .from('weekly_contract_codes')
            .delete()
            .match({ user_id: user.id, project_id: projectId, week_start: weekStart })
        return { success: true }
    }

    const { error } = await supabase
        .from('weekly_contract_codes')
        .upsert(
            {
                user_id: user.id,
                project_id: projectId,
                week_start: weekStart,
                contract_code: code.trim(),
            } as any,
            { onConflict: 'user_id, project_id, week_start' }
        )

    if (error) return { error: error.message }
    return { success: true }
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

    // Copy contract codes from previous week (do this first, independently of entries)
    const { data: prevCodes } = await supabase
        .from('weekly_contract_codes')
        .select('project_id, contract_code')
        .eq('user_id', user.id)
        .eq('week_start', prevStartStr)

    if (prevCodes && prevCodes.length > 0) {
        const codesToCopy = prevCodes.map(c => ({
            user_id: user.id,
            project_id: c.project_id,
            week_start: currentWeekStart,
            contract_code: c.contract_code,
        }))

        await supabase
            .from('weekly_contract_codes')
            .upsert(codesToCopy as any, { onConflict: 'user_id, project_id, week_start' })
    }

    if (!oldEntries || oldEntries.length === 0) {
        revalidatePath('/')
        return { success: true }
    }

    // Check which sub-projects are already submitted for the current week (only block if status is 'submitted')
    const subProjectIds = [...new Set(oldEntries.map(e => e.sub_project_id))]
    const { data: submissions } = await supabase
        .from('timesheet_submissions')
        .select('sub_project_id')
        .eq('user_id', user.id)
        .eq('week_start', currentWeekStart)
        .eq('status', 'submitted')
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
        revalidatePath('/')
        return { success: true }
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
