'use server'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { revalidatePath } from 'next/cache'

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
            end_date: data.endDate,
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
