'use server'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { revalidatePath } from 'next/cache'

export type MonthlyEarningRow = {
    user_id: string
    user_name: string
    total_hours: number
    total_days: number
    unsubmitted_hours: number   // hours from weeks not yet submitted
    unsubmitted_days: number    // days from weeks not yet submitted
    rate_hourly: number | null
    rate_daily: number | null
    earnings_from_hours: number
    earnings_from_days: number
    earnings_pln: number
    total_approved_expenses_pln: number
    sum_pln: number
    project_ids: string[]   // project IDs with hours this month (for filtering)
}

export type TimesheetLine = {
    project_name: string
    sub_project_code: string
    tracking_type: string
    value: number   // hours if tracking_type !== 'days', day count if tracking_type === 'days'
}

export type ExpenseLine = {
    id: string
    purpose: string | null
    start_date: string
    end_date: string | null
    total_pln: number
    receipt_paths: string[]   // non-null receipt_path values from expense_entries
}

export type UserMonthDetail = {
    user_id: string
    user_name: string
    timesheet: TimesheetLine[]
    expenses: ExpenseLine[]
}

function monthBounds(yearMonth: string): { monthStart: string; monthEnd: string } {
    const monthStart = yearMonth + '-01'
    const [year, month] = yearMonth.split('-').map(Number)
    const nextMonth = month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`
    const monthEnd = new Date(new Date(nextMonth).getTime() - 86400000).toISOString().slice(0, 10)
    return { monthStart, monthEnd }
}

// Returns Monday of the week for a given date string (UTC-safe)
function weekStart(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    const dow = date.getUTCDay() // 0=Sun
    const diff = dow === 0 ? -6 : 1 - dow
    date.setUTCDate(date.getUTCDate() + diff)
    return date.toISOString().slice(0, 10)
}

async function getSubmittedKeys(supabase: any, monthStart: string, monthEnd: string): Promise<Set<string>> {
    // Get all submitted timesheet_submissions overlapping this month
    const rangeStart = new Date(new Date(monthStart).getTime() - 6 * 86400000).toISOString().slice(0, 10)
    const { data } = await supabase
        .from('timesheet_submissions')
        .select('user_id, sub_project_id, week_start')
        .eq('status', 'submitted')
        .gte('week_start', rangeStart)
        .lte('week_start', monthEnd)

    const keys = new Set<string>()
    for (const row of (data ?? []) as any[]) {
        keys.add(`${row.user_id}::${row.sub_project_id}::${row.week_start}`)
    }
    return keys
}

export async function getMonthlyEarnings(yearMonth: string, projectId?: string): Promise<MonthlyEarningRow[]> {
    const supabase = await createClient()
    const { monthStart, monthEnd } = monthBounds(yearMonth)

    let entriesQuery = supabase
        .from('timesheet_entries')
        .select('user_id, sub_project_id, work_date, hours, sub_projects ( tracking_type )')
        .gte('work_date', monthStart)
        .lte('work_date', monthEnd)

    const [submittedKeys, entriesResult, profilesResult, projectsResult] = await Promise.all([
        getSubmittedKeys(supabase, monthStart, monthEnd),
        entriesQuery,
        // Fetch ALL employees
        supabase
            .from('profiles')
            .select('id, full_name, rate_hourly, rate_daily, role')
            .order('full_name'),
        // Fetch project → sub_project mapping for filter
        supabase
            .from('projects')
            .select('id, sub_projects ( id )'),
    ])

    const entries = (entriesResult.data ?? []) as any[]

    // Build sub_project_id → project_id map from projects table
    const subToProject = new Map<string, string>()
    for (const proj of ((projectsResult.data ?? []) as any[])) {
        for (const sub of ((proj.sub_projects ?? []) as any[])) {
            subToProject.set(sub.id, proj.id)
        }
    }

    // Build set of sub_project IDs for the selected project filter
    const filterSubProjectIds = projectId
        ? new Set(
            ((projectsResult.data ?? []) as any[])
                .filter(p => p.id === projectId)
                .flatMap(p => ((p.sub_projects ?? []) as any[]).map((s: any) => s.id))
          )
        : null

    // Separate hours vs days per user — all entries, track unsubmitted separately
    const hoursByUser = new Map<string, number>()
    const daysByUser = new Map<string, number>()
    const unsubmittedHoursByUser = new Map<string, number>()
    const unsubmittedDaysByUser = new Map<string, number>()
    const projectIdsByUser = new Map<string, Set<string>>()

    for (const entry of entries) {
        // If filtering by project, skip entries not belonging to that project
        if (filterSubProjectIds && !filterSubProjectIds.has(entry.sub_project_id)) continue

        const key = `${entry.user_id}::${entry.sub_project_id}::${weekStart(entry.work_date)}`
        const isSubmitted = submittedKeys.has(key)

        const trackingType = entry.sub_projects?.tracking_type
        const uid = entry.user_id

        const projId = subToProject.get(entry.sub_project_id)
        if (projId) {
            if (!projectIdsByUser.has(uid)) projectIdsByUser.set(uid, new Set())
            projectIdsByUser.get(uid)!.add(projId)
        }

        if (trackingType === 'days') {
            if ((entry.hours ?? 0) >= 1) {
                daysByUser.set(uid, (daysByUser.get(uid) ?? 0) + 1)
                if (!isSubmitted) unsubmittedDaysByUser.set(uid, (unsubmittedDaysByUser.get(uid) ?? 0) + 1)
            }
        } else {
            const h = entry.hours ?? 0
            hoursByUser.set(uid, (hoursByUser.get(uid) ?? 0) + h)
            if (!isSubmitted) unsubmittedHoursByUser.set(uid, (unsubmittedHoursByUser.get(uid) ?? 0) + h)
        }
    }

    // 2. Fetch approved expenses for the month per user
    let expenseQuery = (supabase as any)
        .from('expense_tables')
        .select('user_id, expense_entries ( amount_pln )')
        .eq('status', 'approved')
        .gte('start_date', monthStart)
        .lte('start_date', monthEnd)
    if (projectId) {
        expenseQuery = expenseQuery.eq('project_id', projectId)
    }
    const { data: expenseTables } = await expenseQuery

    const expensesByUser = new Map<string, number>()
    for (const table of (expenseTables ?? []) as any[]) {
        const prev = expensesByUser.get(table.user_id) ?? 0
        const tableTotal = ((table.expense_entries ?? []) as any[])
            .reduce((sum: number, e: any) => sum + Number(e.amount_pln ?? 0), 0)
        expensesByUser.set(table.user_id, prev + tableTotal)
    }

    // 3. Build rows for ALL employees
    const profiles = (profilesResult.data ?? []) as any[]
    const rows: MonthlyEarningRow[] = profiles.map((p) => {
        const hours = hoursByUser.get(p.id) ?? 0
        const days = daysByUser.get(p.id) ?? 0
        const rateH = p.rate_hourly ? Number(p.rate_hourly) : null
        const rateD = p.rate_daily ? Number(p.rate_daily) : null

        // Hours earnings: hours × rate_hourly (fall back: hours / 8 × rate_daily)
        const earningsFromHours = hours === 0 ? 0
            : rateH != null ? hours * rateH
            : rateD != null ? (hours / 8) * rateD
            : 0

        // Days earnings: days × rate_daily (fall back: days × 8 × rate_hourly)
        const earningsFromDays = days === 0 ? 0
            : rateD != null ? days * rateD
            : rateH != null ? days * 8 * rateH
            : 0

        const earnings = Math.round((earningsFromHours + earningsFromDays) * 100) / 100
        const expenses = Math.round((expensesByUser.get(p.id) ?? 0) * 100) / 100

        const efh = Math.round(earningsFromHours * 100) / 100
        const efd = Math.round(earningsFromDays * 100) / 100

        return {
            user_id: p.id,
            user_name: p.full_name ?? 'Unknown',
            total_hours: hours,
            total_days: days,
            unsubmitted_hours: unsubmittedHoursByUser.get(p.id) ?? 0,
            unsubmitted_days: unsubmittedDaysByUser.get(p.id) ?? 0,
            rate_hourly: rateH,
            rate_daily: rateD,
            earnings_from_hours: efh,
            earnings_from_days: efd,
            earnings_pln: earnings,
            total_approved_expenses_pln: expenses,
            sum_pln: Math.round((earnings + expenses) * 100) / 100,
            project_ids: [...(projectIdsByUser.get(p.id) ?? [])],
        }
    })

    return rows
}

export async function getUserMonthDetail(userId: string, yearMonth: string): Promise<UserMonthDetail | null> {
    const supabase = await createClient()
    const { monthStart, monthEnd } = monthBounds(yearMonth)

    // Profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', userId)
        .single()

    if (!profile) return null

    // Timesheet: submitted entries only
    const [submittedKeys, tsEntriesResult] = await Promise.all([
        getSubmittedKeys(supabase, monthStart, monthEnd),
        supabase
            .from('timesheet_entries')
            .select('sub_project_id, work_date, hours, sub_projects ( code, tracking_type, projects ( name ) )')
            .eq('user_id', userId)
            .gte('work_date', monthStart)
            .lte('work_date', monthEnd),
    ])

    // Group by sub_project
    const tsMap = new Map<string, TimesheetLine>()
    for (const e of (tsEntriesResult.data ?? []) as any[]) {
        const submissionKey = `${userId}::${e.sub_project_id}::${weekStart(e.work_date)}`
        if (!submittedKeys.has(submissionKey)) continue
        const code: string = e.sub_projects?.code ?? '—'
        const project: string = e.sub_projects?.projects?.name ?? '—'
        const tracking: string = e.sub_projects?.tracking_type ?? 'hours'
        const key = `${project}::${code}`

        const prev = tsMap.get(key)
        if (prev) {
            if (tracking === 'days') {
                prev.value += (e.hours ?? 0) >= 1 ? 1 : 0
            } else {
                prev.value += e.hours ?? 0
            }
        } else {
            tsMap.set(key, {
                project_name: project,
                sub_project_code: code,
                tracking_type: tracking,
                value: tracking === 'days'
                    ? ((e.hours ?? 0) >= 1 ? 1 : 0)
                    : (e.hours ?? 0),
            })
        }
    }

    const timesheet: TimesheetLine[] = [...tsMap.values()]
        .filter(l => l.value > 0)
        .sort((a, b) => a.project_name.localeCompare(b.project_name) || a.sub_project_code.localeCompare(b.sub_project_code))

    // Approved expenses
    const { data: expTables } = await (supabase as any)
        .from('expense_tables')
        .select('id, purpose, start_date, end_date, expense_entries ( amount_pln, receipt_path )')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .gte('start_date', monthStart)
        .lte('start_date', monthEnd)
        .order('start_date', { ascending: true })

    const expenses: ExpenseLine[] = ((expTables ?? []) as any[]).map((t: any) => ({
        id: t.id,
        purpose: t.purpose,
        start_date: t.start_date,
        end_date: t.end_date,
        total_pln: ((t.expense_entries ?? []) as any[])
            .reduce((sum: number, e: any) => sum + Number(e.amount_pln ?? 0), 0),
        receipt_paths: ((t.expense_entries ?? []) as any[])
            .map((e: any) => e.receipt_path)
            .filter(Boolean) as string[],
    }))

    return { user_id: userId, user_name: profile.full_name ?? 'Unknown', timesheet, expenses }
}

// ─── Status ───

export type EarningStatus = 'pending' | 'submitted' | 'paid' | 'declined'

export async function getStatusesForMonth(yearMonth: string): Promise<Record<string, EarningStatus>> {
    const supabase = await createClient()
    const { data } = await (supabase as any)
        .from('earnings_month_status')
        .select('user_id, status')
        .eq('year_month', yearMonth)

    const result: Record<string, EarningStatus> = {}
    for (const row of (data ?? []) as any[]) {
        result[row.user_id] = row.status as EarningStatus
    }
    return result
}

export async function setEarningStatus(userId: string, yearMonth: string, status: EarningStatus) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { error } = await (supabase as any)
        .from('earnings_month_status')
        .upsert(
            { user_id: userId, year_month: yearMonth, status, updated_by: user.id, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,year_month' }
        )

    if (error) return { error: error.message }
    revalidatePath('/admin/earnings')
    return { success: true }
}

// ─── Document signed URLs ───

export type EarningsDocUrls = {
    timesheetPdfUrl: string | null
    receiptUrls: Record<string, string>  // receipt_path → signed URL
}

export async function getEarningsDocUrls(userId: string, yearMonth: string, receiptPaths: string[]): Promise<EarningsDocUrls> {
    const admin = getSupabaseAdmin()

    // Timesheet PDF for this user+month
    const { data: pdfRecord } = await admin
        .from('pdf_exports')
        .select('storage_path')
        .eq('user_id', userId)
        .eq('month', yearMonth)
        .maybeSingle() as any

    let timesheetPdfUrl: string | null = null
    if (pdfRecord?.storage_path) {
        const { data } = await admin.storage
            .from('timesheet-exports')
            .createSignedUrl(pdfRecord.storage_path, 3600)
        timesheetPdfUrl = data?.signedUrl ?? null
    }

    // Expense receipt signed URLs
    const receiptUrls: Record<string, string> = {}
    await Promise.all(
        receiptPaths.map(async (path) => {
            const { data } = await admin.storage
                .from('expense-receipts')
                .createSignedUrl(path, 3600)
            if (data?.signedUrl) receiptUrls[path] = data.signedUrl
        })
    )

    return { timesheetPdfUrl, receiptUrls }
}
