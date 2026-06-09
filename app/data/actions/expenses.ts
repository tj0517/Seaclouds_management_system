'use server'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { revalidatePath } from 'next/cache'

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
        .select('expense_table_id, expense_tables:expense_table_id ( status )')
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
    created_at: string
}

export async function getExpenseTables(): Promise<ExpenseTableWithProject[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await (supabase as any)
        .from('expense_tables')
        .select('*, projects:project_id ( name )')
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

export async function uploadReceipt(entryId: string, formData: FormData) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const parentStatus = await getTableStatusForEntry(supabase, entryId)
    if (parentStatus === 'submitted' || parentStatus === 'approved') return { error: 'Cannot modify a submitted or approved expense table' }

    const file = formData.get('file') as File
    if (!file) return { error: 'No file provided' }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const storagePath = `receipts/${user.id}/${entryId}.${ext}`

    const adminClient = getSupabaseAdmin()

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error: uploadError } = await adminClient.storage
        .from('expense-receipts')
        .upload(storagePath, buffer, {
            contentType: file.type,
            upsert: true,
        })

    if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

    // Update entry with receipt path
    const { error: updateError } = await (supabase as any)
        .from('expense_entries')
        .update({ receipt_path: storagePath })
        .eq('id', entryId)

    if (updateError) return { error: updateError.message }

    revalidatePath('/expenses')
    return { success: true, path: storagePath }
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

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({ status: 'submitted' })
        .eq('id', id)
        .eq('user_id', user.id)

    if (error) return { error: error.message }

    revalidatePath('/expenses')
    return { success: true }
}

export async function withdrawExpenseSubmission(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const tableCheck = await getTableStatus(supabase, id, user.id)
    if (!tableCheck) return { error: 'Table not found' }
    if (tableCheck.status !== 'submitted' && tableCheck.status !== 'declined') return { error: 'Table is not submitted or declined' }

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({ status: 'draft', reviewed_at: null, reviewed_by: null })
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
    created_at: string
    entry_count: number
    total_amount: number
}

export async function getAdminExpenseTables(): Promise<AdminExpenseTable[]> {
    const supabase = await createClient()

    const { data, error } = await (supabase as any)
        .from('expense_tables')
        .select('*, projects:project_id ( name ), profiles:user_id ( full_name, email )')
        .order('created_at', { ascending: false })

    if (error || !data) return []

    // Get entry counts and totals
    const tableIds = (data as any[]).map((r: any) => r.id)
    const { data: entries } = await (supabase as any)
        .from('expense_entries')
        .select('expense_table_id, amount')
        .in('expense_table_id', tableIds)

    const entryStats: Record<string, { count: number; total: number }> = {}
    for (const e of (entries || []) as any[]) {
        if (!entryStats[e.expense_table_id]) entryStats[e.expense_table_id] = { count: 0, total: 0 }
        entryStats[e.expense_table_id].count++
        entryStats[e.expense_table_id].total += Number(e.amount)
    }

    return (data as any[]).map((row: any) => ({
        id: row.id,
        user_id: row.user_id,
        user_name: row.profiles?.full_name ?? 'Unknown',
        user_email: row.profiles?.email ?? '',
        project_id: row.project_id,
        project_name: row.projects?.name ?? 'Unknown',
        work_order: row.work_order,
        purpose: row.purpose,
        start_date: row.start_date,
        end_date: row.end_date ?? '',
        status: row.status ?? 'draft',
        created_at: row.created_at,
        entry_count: entryStats[row.id]?.count ?? 0,
        total_amount: entryStats[row.id]?.total ?? 0,
    }))
}

export async function getAdminExpenseTableDetail(id: string) {
    const supabase = await createClient()

    const { data, error } = await (supabase as any)
        .from('expense_tables')
        .select('*, projects:project_id ( name ), profiles:user_id ( full_name, email )')
        .eq('id', id)
        .single()

    if (error || !data) return null

    return {
        id: (data as any).id,
        user_id: (data as any).user_id,
        user_name: (data as any).profiles?.full_name ?? 'Unknown',
        user_email: (data as any).profiles?.email ?? '',
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
    }
}

export async function approveExpenseTable(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { data: table } = await (supabase as any)
        .from('expense_tables')
        .select('status')
        .eq('id', id)
        .single()

    if (!table) return { error: 'Table not found' }
    if (table.status !== 'submitted') return { error: 'Only submitted tables can be approved' }

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/admin/expenses')
    revalidatePath('/expenses')
    return { success: true }
}

export async function declineExpenseTable(id: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const { data: table } = await (supabase as any)
        .from('expense_tables')
        .select('status')
        .eq('id', id)
        .single()

    if (!table) return { error: 'Table not found' }
    if (table.status !== 'submitted') return { error: 'Only submitted tables can be declined' }

    const { error } = await (supabase as any)
        .from('expense_tables')
        .update({ status: 'declined', reviewed_at: new Date().toISOString(), reviewed_by: user.id })
        .eq('id', id)

    if (error) return { error: error.message }

    revalidatePath('/admin/expenses')
    revalidatePath('/expenses')
    return { success: true }
}
