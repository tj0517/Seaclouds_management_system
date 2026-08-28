'use server'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { revalidatePath } from 'next/cache'
import { fetchNbpRate } from './nbp'
import { sendExpenseSubmittedNotification, sendExpenseApprovedNotification, sendExpenseDeclineNotification } from '@/lib/email'

async function getTableStatus(supabase: any, tableId: string, userId: string): Promise<{ status: string } | null> {
    const { data } = await (supabase as any)
        .from('expense_tables')
        .select('status')
        .eq('id', tableId)
        .eq('user_id', userId)
        .single()
    return data
}

async function getTableStatusForEntry(supabase: any, entryId: string): Promise<string | null> {
    const { data } = await (supabase as any)
        .from('expense_entries')
        .select('expense_table_id, expense_tables ( status )')
        .eq('id', entryId)
        .single()
    return (data as any)?.expense_tables?.status ?? null
}

export type ExpenseTableWithProject = {
    id: string
    user_id: string
    project_id: string
    work_order: string | null
    purpose: string | null
    start_date: string
    end_date: string
    created_at: string
    project_name: string
    status: string
    decline_reason: string | null
}

export type ExpenseEntry = {
    id: string
    expense_table_id: string
    expense_date: string
    expense_date_end: string | null
    location: string | null
    expense_type: string
    description: string | null
    currency: string
    amount: number
    km: number | null
    km_rate: number | null
    receipt_path: string | null
    exchange_rate: number | null
    amount_pln: number | null
    created_at: string
}

export async function getExpenseTables(): Promise<ExpenseTableWithProject[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await (supabase as any)
        .from('expense_tables')
        .select('*, projects ( name )')
        .eq('user_id', user.id)
        .order('start_date', { ascending: false })

    if (error || !data) return []

    return (data as any[]).map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        project_id: row.project_id,
        work_order: row.work_order,
        purpose: row.purpose,
        start_date: row.start_date,
        end_date: row.end_date,
        created_at: row.created_at,
        project_name: row.projects?.name ?? 'Unknown',
        status: row.status ?? 'draft',
        decline_reason: row.decline_reason ?? null,
    }))
}

export async function createExpenseTable(data: {
    projectId: string
    workOrder: string
    purpose: string
    startDate: string
    endDate: string
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Validate dates are within the same month
    if (data.endDate && data.startDate.slice(0, 7) !== data.endDate.slice(0, 7)) {
        return { error: 'Start and end dates must be within the same month' }
    }

    const { data: inserted, error } = await (supabase as any)
        .from('expense_tables')
        .insert({
            user_id: user.id,
            project_id: data.projectId,
            work_order: data.workOrder || null,
            purpose: data.purpose || null,
            start_date: data.startDate,
            end_date: data.endDate || null,
        })
        .select('id')
        .single()

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true, id: (inserted as any).id }
}

export async function updateExpenseTable(id: string, data: {
    projectId?: string
    workOrder?: string
    purpose?: string
    startDate?: string
    endDate?: string
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const tableCheck = await getTableStatus(supabase, id, user.id)
    if (tableCheck?.status === 'submitted' || tableCheck?.status === 'approved') return { error: 'Cannot edit a submitted or approved expense table' }

    // Validate dates are within the same month
    const startMonth = data.startDate?.slice(0, 7)
    const endMonth = data.endDate?.slice(0, 7)
    if (startMonth && endMonth && startMonth !== endMonth) {
        return { error: 'Start and end dates must be within the same month' }
    }

    const updateData: any = {}
    if (data.projectId !== undefined) updateData.project_id = data.projectId
    if (data.workOrder !== undefined) updateData.work_order = data.workOrder || null
    if (data.purpose !== undefined) updateData.purpose = data.purpose || null
    if (data.startDate !== undefined) updateData.start_date = data.startDate
    if (data.endDate !== undefined) updateData.end_date = data.endDate

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', user.id)

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true }
}

export async function deleteExpenseTable(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const tableCheck = await getTableStatus(supabase, id, user.id)
    if (tableCheck?.status === 'submitted' || tableCheck?.status === 'approved') return { error: 'Cannot delete a submitted or approved expense table' }

    // Get entries to clean up receipt files
    const { data: entries } = await (supabase as any)
        .from('expense_entries')
        .select('receipt_path')
        .eq('expense_table_id', id)

    const adminClient = getSupabaseAdmin()

    // Delete receipt files from storage
    const receiptPaths = ((entries || []) as any[])
        .map((e: any) => e.receipt_path)
        .filter((p: any): p is string => !!p)

    if (receiptPaths.length > 0) {
        await adminClient.storage
            .from('expense-receipts')
            .remove(receiptPaths)
    }

    // Delete the table (cascade deletes entries)
    const { error } = await (supabase as any)
        .from('expense_tables')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true }
}

export async function getExpenseEntries(tableId: string): Promise<ExpenseEntry[]> {
    const supabase = await createClient()

    const { data, error } = await (supabase as any)
        .from('expense_entries')
        .select('*')
        .eq('expense_table_id', tableId)
        .order('expense_date', { ascending: true })

    if (error || !data) return []

    return data as ExpenseEntry[]
}

export async function saveExpenseEntry(data: {
    tableId: string
    date: string
    dateEnd?: string
    location: string
    type: string
    description: string
    currency: string
    amount: number
    km?: number
    kmRate?: number
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const tableCheck = await getTableStatus(supabase, data.tableId, user.id)
    if (tableCheck?.status === 'submitted' || tableCheck?.status === 'approved') return { error: 'Cannot modify a submitted or approved expense table' }

    // Fetch NBP exchange rate for PLN conversion
    let exchange_rate = 1.0
    let amount_pln = data.amount
    try {
        exchange_rate = await fetchNbpRate(data.currency, data.date)
        amount_pln = Math.round(data.amount * exchange_rate * 100) / 100
    } catch {
        // If rate fetch fails for non-PLN, still save but without conversion
        if (data.currency !== 'PLN') {
            exchange_rate = null as any
            amount_pln = null as any
        }
    }

    const { data: inserted, error } = await (supabase as any)
        .from('expense_entries')
        .insert({
            expense_table_id: data.tableId,
            expense_date: data.date,
            expense_date_end: data.dateEnd || null,
            location: data.location || null,
            expense_type: data.type,
            description: data.description || null,
            currency: data.currency,
            amount: data.amount,
            km: data.km ?? null,
            km_rate: data.kmRate ?? null,
            exchange_rate,
            amount_pln,
        })
        .select('id')
        .single()

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true, id: (inserted as any).id }
}

export async function updateExpenseEntry(id: string, data: {
    date?: string
    dateEnd?: string | null
    location?: string
    type?: string
    description?: string
    currency?: string
    amount?: number
    km?: number | null
    kmRate?: number | null
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const parentStatus = await getTableStatusForEntry(supabase, id)
    if (parentStatus === 'submitted' || parentStatus === 'approved') return { error: 'Cannot modify a submitted or approved expense table' }

    const updateData: any = {}
    if (data.date !== undefined) updateData.expense_date = data.date
    if (data.dateEnd !== undefined) updateData.expense_date_end = data.dateEnd
    if (data.location !== undefined) updateData.location = data.location || null
    if (data.type !== undefined) updateData.expense_type = data.type
    if (data.description !== undefined) updateData.description = data.description || null
    if (data.currency !== undefined) updateData.currency = data.currency
    if (data.amount !== undefined) updateData.amount = data.amount
    if (data.km !== undefined) updateData.km = data.km
    if (data.kmRate !== undefined) updateData.km_rate = data.kmRate

    // Re-fetch exchange rate if amount, currency, or date changed
    const needsRateUpdate = data.amount !== undefined || data.currency !== undefined || data.date !== undefined
    if (needsRateUpdate) {
        // Get current entry values to merge with updates
        const { data: current } = await (supabase as any)
            .from('expense_entries')
            .select('currency, amount, expense_date')
            .eq('id', id)
            .single()

        if (current) {
            const currency = data.currency ?? current.currency
            const amount = data.amount ?? Number(current.amount)
            const date = data.date ?? current.expense_date

            try {
                const rate = await fetchNbpRate(currency, date)
                updateData.exchange_rate = rate
                updateData.amount_pln = Math.round(amount * rate * 100) / 100
            } catch {
                if (currency === 'PLN') {
                    updateData.exchange_rate = 1.0
                    updateData.amount_pln = amount
                } else {
                    updateData.exchange_rate = null
                    updateData.amount_pln = null
                }
            }
        }
    }

    const { error } = await (supabase as any)
        .from('expense_entries')
        .update(updateData)
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true }
}

export async function deleteExpenseEntry(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const parentStatus = await getTableStatusForEntry(supabase, id)
    if (parentStatus === 'submitted' || parentStatus === 'approved') return { error: 'Cannot modify a submitted or approved expense table' }

    // Get receipt path before deleting
    const { data: entry } = await (supabase as any)
        .from('expense_entries')
        .select('receipt_path')
        .eq('id', id)
        .single()

    if (entry?.receipt_path) {
        const adminClient = getSupabaseAdmin()
        await adminClient.storage
            .from('expense-receipts')
            .remove([entry.receipt_path])
    }

    const { error } = await (supabase as any)
        .from('expense_entries')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true }
}

/**
 * Step 1: Get a signed upload URL for a receipt. No file data goes through the server action.
 */
export async function getReceiptUploadUrl(entryId: string, fileName: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const adminClient = getSupabaseAdmin()

    // Verify ownership — separate queries to avoid nested select issues
    const { data: entry, error: entryError } = await (adminClient as any)
        .from('expense_entries')
        .select('id, expense_table_id')
        .eq('id', entryId)
        .single()

    if (entryError || !entry) return { error: `Entry not found: ${entryError?.message || entryId}` }

    const { data: table } = await (adminClient as any)
        .from('expense_tables')
        .select('user_id, status')
        .eq('id', entry.expense_table_id)
        .single()

    if (!table) return { error: 'Expense table not found' }
    if (table.user_id !== user.id) return { error: 'Access denied' }
    if (table.status === 'submitted' || table.status === 'approved') return { error: 'Cannot modify a submitted or approved expense table' }

    const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg'
    const storagePath = `receipts/${user.id}/${entryId}.${ext}`

    // Create signed upload URL (valid 60s)
    const { data, error } = await adminClient.storage
        .from('expense-receipts')
        .createSignedUploadUrl(storagePath, { upsert: true })

    if (error) return { error: `Failed to create upload URL: ${error.message}` }

    return { signedUrl: data.signedUrl, storagePath }
}

/**
 * Step 2: After client-side upload completes, save the receipt path to the entry.
 */
export async function confirmReceiptUpload(entryId: string, storagePath: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Verify ownership
    const adminClient = getSupabaseAdmin()
    const { data: entry } = await (adminClient as any)
        .from('expense_entries')
        .select('id, expense_table_id')
        .eq('id', entryId)
        .single()

    if (!entry) return { error: 'Entry not found' }

    const { data: table } = await (adminClient as any)
        .from('expense_tables')
        .select('user_id')
        .eq('id', entry.expense_table_id)
        .single()

    if (!table || table.user_id !== user.id) return { error: 'Access denied' }

    // Verify the path matches the user
    if (!storagePath.startsWith(`receipts/${user.id}/`)) return { error: 'Invalid path' }

    const { error: updateError } = await (getSupabaseAdmin() as any)
        .from('expense_entries')
        .update({ receipt_path: storagePath })
        .eq('id', entryId)

    if (updateError) return { error: updateError.message }

    revalidatePath('/expenses')
    return { success: true }
}

export async function getReceiptUrl(entryId: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { data: entry } = await (supabase as any)
        .from('expense_entries')
        .select('receipt_path')
        .eq('id', entryId)
        .single()

    if (!entry?.receipt_path) return { error: 'No receipt found' }

    const adminClient = getSupabaseAdmin()
    const { data: signedUrlData, error } = await adminClient.storage
        .from('expense-receipts')
        .createSignedUrl(entry.receipt_path, 60 * 60) // 1 hour

    if (error || !signedUrlData) return { error: 'Failed to generate URL' }

    return { url: signedUrlData.signedUrl }
}

export async function deleteReceipt(entryId: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const parentStatus = await getTableStatusForEntry(supabase, entryId)
    if (parentStatus === 'submitted' || parentStatus === 'approved') return { error: 'Cannot modify a submitted or approved expense table' }

    const { data: entry } = await (supabase as any)
        .from('expense_entries')
        .select('receipt_path')
        .eq('id', entryId)
        .single()

    if (!entry?.receipt_path) return { error: 'No receipt found' }

    const adminClient = getSupabaseAdmin()
    await adminClient.storage
        .from('expense-receipts')
        .remove([entry.receipt_path])

    const { error } = await (supabase as any)
        .from('expense_entries')
        .update({ receipt_path: null })
        .eq('id', entryId)

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true }
}

export async function submitExpenseTable(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const tableCheck = await getTableStatus(supabase, id, user.id)
    if (!tableCheck) return { error: 'Table not found' }
    if (tableCheck.status === 'submitted') return { error: 'Table is already submitted' }

    // Verify table has at least 1 entry
    const { count } = await (supabase as any)
        .from('expense_entries')
        .select('id', { count: 'exact', head: true })
        .eq('expense_table_id', id)

    if (!count || count === 0) return { error: 'Cannot submit an empty expense table. Add at least one entry.' }

    // Fetch table info for email before updating
    const { data: tableInfo } = await (supabase as any)
        .from('expense_tables')
        .select('start_date, end_date, project_id, projects ( name )')
        .eq('id', id)
        .single()

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({ status: 'submitted' })
        .eq('id', id)
        .eq('user_id', user.id)

    if (error) return { error: error.message }

    // Email notification to admin
    try {
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .single()

        const dateRange = tableInfo?.end_date
            ? `${tableInfo.start_date} — ${tableInfo.end_date}`
            : tableInfo?.start_date ?? ''

        await sendExpenseSubmittedNotification({
            employeeName: profile?.full_name ?? 'Employee',
            projectName: tableInfo?.projects?.name ?? 'Unknown',
            dateRange,
        })
    } catch (e) {
        console.error('Failed to send expense submit notification:', e)
    }

    revalidatePath('/expenses')
    return { success: true }
}

export async function withdrawExpenseSubmission(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const tableCheck = await getTableStatus(supabase, id, user.id)
    if (!tableCheck) return { error: 'Table not found' }
    if (tableCheck.status !== 'declined') return { error: 'Cannot withdraw — only declined expenses can be withdrawn' }

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({ status: 'draft', reviewed_at: null, reviewed_by: null, decline_reason: null })
        .eq('id', id)
        .eq('user_id', user.id)

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true }
}

// ─── Admin Actions ───

export type AdminExpenseTable = {
    id: string
    user_id: string
    user_name: string
    user_email: string
    project_id: string
    project_name: string
    work_order: string | null
    purpose: string | null
    start_date: string
    end_date: string
    status: string
    decline_reason: string | null
    created_at: string
    entry_count: number
    total_amount: number
}

export async function getAdminExpenseTables(): Promise<AdminExpenseTable[]> {
    const supabase = await createClient()

    const { data, error } = await (supabase as any)
        .from('expense_tables')
        .select('*, projects ( name )')
        .order('created_at', { ascending: false })

    if (error || !data) return []

    // Fetch profiles separately (no FK from expense_tables to profiles)
    const userIds = [...new Set((data as any[]).map((r: any) => r.user_id))]
    const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
    const profileMap = new Map(
        (profileRows || []).map((p: any) => [p.id, p])
    )

    // Get entry counts and totals (using amount_pln for unified PLN total)
    const tableIds = (data as any[]).map((r: any) => r.id)
    const { data: entries } = await (supabase as any)
        .from('expense_entries')
        .select('expense_table_id, amount, amount_pln')
        .in('expense_table_id', tableIds)

    const entryStats: Record<string, { count: number; total: number }> = {}
    for (const e of (entries || []) as any[]) {
        if (!entryStats[e.expense_table_id]) entryStats[e.expense_table_id] = { count: 0, total: 0 }
        entryStats[e.expense_table_id].count++
        entryStats[e.expense_table_id].total += Number(e.amount_pln ?? e.amount)
    }

    return (data as any[]).map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        user_name: profileMap.get(row.user_id)?.full_name ?? 'Unknown',
        user_email: '',
        project_id: row.project_id,
        project_name: row.projects?.name ?? 'Unknown',
        work_order: row.work_order,
        purpose: row.purpose,
        start_date: row.start_date,
        end_date: row.end_date ?? '',
        status: row.status ?? 'draft',
        decline_reason: row.decline_reason ?? null,
        created_at: row.created_at,
        entry_count: entryStats[row.id]?.count ?? 0,
        total_amount: entryStats[row.id]?.total ?? 0,
    }))
}

export async function getAdminExpenseTableDetail(id: string) {
    const supabase = await createClient()

    const { data, error } = await (supabase as any)
        .from('expense_tables')
        .select('*, projects ( name )')
        .eq('id', id)
        .single()

    if (error || !data) return null

    // Fetch profile separately
    const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', (data as any).user_id)
        .single()

    return {
        id: (data as any).id,
        user_id: (data as any).user_id,
        user_name: profile?.full_name ?? 'Unknown',
        user_email: '',
        project_id: (data as any).project_id,
        project_name: (data as any).projects?.name ?? 'Unknown',
        work_order: (data as any).work_order,
        purpose: (data as any).purpose,
        start_date: (data as any).start_date,
        end_date: (data as any).end_date ?? '',
        status: (data as any).status ?? 'draft',
        created_at: (data as any).created_at,
        reviewed_at: (data as any).reviewed_at,
        reviewed_by: (data as any).reviewed_by,
        decline_reason: (data as any).decline_reason ?? null,
    }
}

export async function approveExpenseTable(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { data: table } = await (supabase as any)
        .from('expense_tables')
        .select('status, user_id, project_id, projects ( name )')
        .eq('id', id)
        .single()

    if (!table) return { error: 'Table not found' }
    if (table.status !== 'submitted') return { error: 'Only submitted tables can be approved' }

    // Auth: admin or PM for this project
    const { getUserRoleAndProjects, hasProjectAccess } = await import('./auth-helpers')
    const roleInfo = await getUserRoleAndProjects()
    if (!roleInfo || (roleInfo.role !== 'admin' && !hasProjectAccess(roleInfo, table.project_id))) {
        return { error: 'Unauthorized' }
    }

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
        .eq('id', id)

    if (error) return { error: error.message }

    // Email notification to employee
    try {
        const adminClient = getSupabaseAdmin()
        const { data: authUser } = await adminClient.auth.admin.getUserById(table.user_id)
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', table.user_id)
            .single()

        if (authUser?.user?.email) {
            await sendExpenseApprovedNotification({
                employeeEmail: authUser.user.email,
                employeeName: profile?.full_name ?? 'Employee',
                projectName: table.projects?.name ?? 'Unknown',
            })
        }
    } catch {
        // Don't fail the approval if email fails
    }

    revalidatePath('/admin/expenses')
    revalidatePath('/expenses')
    return { success: true }
}

export async function declineExpenseTable(id: string, reason: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { data: table } = await (supabase as any)
        .from('expense_tables')
        .select('status, user_id, project_id, projects ( name )')
        .eq('id', id)
        .single()

    if (!table) return { error: 'Table not found' }
    if (table.status !== 'submitted') return { error: 'Only submitted tables can be declined' }

    // Auth: admin or PM for this project
    const { getUserRoleAndProjects, hasProjectAccess } = await import('./auth-helpers')
    const roleInfo = await getUserRoleAndProjects()
    if (!roleInfo || (roleInfo.role !== 'admin' && !hasProjectAccess(roleInfo, table.project_id))) {
        return { error: 'Unauthorized' }
    }

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({
            status: 'declined',
            reviewed_at: new Date().toISOString(),
            reviewed_by: user.id,
            decline_reason: reason || null,
        })
        .eq('id', id)

    if (error) return { error: error.message }

    // Send decline notification email
    try {
        const adminClient = getSupabaseAdmin()
        const { data: authUser } = await adminClient.auth.admin.getUserById(table.user_id)
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', table.user_id)
            .single()

        if (authUser?.user?.email) {
            await sendExpenseDeclineNotification({
                employeeEmail: authUser.user.email,
                employeeName: profile?.full_name ?? 'Employee',
                projectName: table.projects?.name ?? 'Unknown',
                reason: reason || 'No reason provided',
            })
        }
    } catch {
        // Don't fail the decline if email fails
    }

    revalidatePath('/admin/expenses')
    revalidatePath('/expenses')
    return { success: true }
}

export async function resetExpenseTableStatus(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { data: table } = await (supabase as any)
        .from('expense_tables')
        .select('status, project_id')
        .eq('id', id)
        .single()

    if (!table) return { error: 'Table not found' }
    if (table.status !== 'approved' && table.status !== 'declined') {
        return { error: 'Only approved or declined tables can be reset' }
    }

    // Auth: admin or PM for this project
    const { getUserRoleAndProjects, hasProjectAccess } = await import('./auth-helpers')
    const roleInfo = await getUserRoleAndProjects()
    if (!roleInfo || (roleInfo.role !== 'admin' && !hasProjectAccess(roleInfo, table.project_id))) {
        return { error: 'Unauthorized' }
    }

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({
            status: 'submitted',
            reviewed_at: null,
            reviewed_by: null,
            decline_reason: null,
        })
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/admin/expenses')
    revalidatePath('/expenses')
    return { success: true }
}
