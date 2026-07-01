'use server'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { format, startOfMonth, endOfMonth, parseISO, eachDayOfInterval, startOfWeek } from 'date-fns'
import { getGroupedReportData, type GroupedReportRow } from './timesheet'
import type { ExpenseEntry } from './expenses'
import path from 'path'

const FONT_DIR = path.join(process.cwd(), 'lib', 'fonts')
const FONT_REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf')
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')
const FONT_OBLIQUE = path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf')

function registerFonts(doc: any) {
    doc.registerFont('Sans', FONT_REGULAR)
    doc.registerFont('Sans-Bold', FONT_BOLD)
    doc.registerFont('Sans-Oblique', FONT_OBLIQUE)
}

export async function generateMonthlyPdf(month: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Fetch user profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    if (!profile) return { error: 'Profile not found' }

    // Parse month (YYYY-MM format)
    const monthDate = parseISO(`${month}-01`)
    const startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd')
    const endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd')

    // Fetch timesheet data for this user (use admin client to bypass RLS on joined tables)
    const adminClient = getSupabaseAdmin()
    const rows = await getGroupedReportData(startDate, endDate, { userId: user.id }, adminClient)

    if (rows.length === 0) return { error: 'No timesheet data for this month' }

    // Fetch contract codes for all weeks in this month
    const { data: contractCodesData } = await supabase
        .from('weekly_contract_codes')
        .select('project_id, week_start, contract_code')
        .eq('user_id', user.id)
        .gte('week_start', startDate)
        .lte('week_start', endDate)

    // Map: projectName -> weekStart -> contractCode
    const contractCodeMap: Record<string, Record<string, string>> = {}
    // Fetch project_id for all sub_projects in one query
    const subProjectIds = [...new Set(rows.map(r => r.subProjectId))]
    const { data: spDataAll } = await supabase
        .from('sub_projects')
        .select('id, project_id')
        .in('id', subProjectIds)

    const projectIdToName: Record<string, string> = {}
    for (const row of rows) {
        const sp = spDataAll?.find(s => s.id === row.subProjectId)
        if (sp) projectIdToName[sp.project_id] = row.projectName
    }

    for (const cc of contractCodesData || []) {
        const pName = projectIdToName[cc.project_id] || cc.project_id
        if (!contractCodeMap[pName]) contractCodeMap[pName] = {}
        contractCodeMap[pName][cc.week_start] = cc.contract_code
    }

    // Build daily breakdown: date -> array of { code, description, hours, earnings }
    const allDays = eachDayOfInterval({ start: parseISO(startDate), end: parseISO(endDate) })
    type DayEntry = { code: string; description: string; hours: number; trackingType: string; contractCode: string }
    const dailyData: Record<string, DayEntry[]> = {}

    for (const row of rows) {
        for (const [date, hours] of Object.entries(row.dailyBreakdown)) {
            if (hours <= 0) continue
            if (!dailyData[date]) dailyData[date] = []
            // Get contract code for this project + week
            const ws = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
            const cc = contractCodeMap[row.projectName]?.[ws] || ''
            dailyData[date].push({
                code: row.subProjectCode,
                description: row.subProjectDescription || row.projectName,
                hours,
                trackingType: row.trackingType,
                contractCode: cc,
            })
        }
    }

    // Calculate totals
    const totalHours = rows.filter(r => r.trackingType !== 'days').reduce((s, r) => s + r.totalHours, 0)
    const totalDays = rows.filter(r => r.trackingType === 'days').reduce((s, r) => s + r.totalHours, 0)

    const PDFDocument = (await import('pdfkit')).default
    const monthLabel = format(monthDate, 'MMMM yyyy')
    const sortedDates = Object.keys(dailyData).sort()

    // Table column positions
    const colX = { date: 40, code: 110, contract: 170, desc: 270, hours: 430, days: 490 }
    const pageWidth = 595.28 // A4
    const rightMargin = 40

    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    registerFonts(doc)
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))

    // Header
    doc.fontSize(16).font('Sans-Bold').text('Seaclouds - Monthly Timesheet Report', 40, 40)
    doc.fontSize(12).font('Sans').fillColor('#444444').text(`Month: ${monthLabel}`, 40, 62)

    // Employee info
    doc.moveDown(0.5)
    const infoY = doc.y
    doc.fontSize(10).fillColor('#000000').font('Sans')
    doc.text(`Name: ${profile.full_name || 'N/A'}`, 40, infoY)
    doc.text(`Employee ID: ${profile.employee_id || 'N/A'}`, 300, infoY)
    doc.text(`Position: ${profile.position || 'N/A'}`, 40, infoY + 16)

    // Table header
    let y = infoY + 44
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 6
    doc.font('Sans-Bold').fontSize(8).fillColor('#000000')
    doc.text('Date', colX.date, y)
    doc.text('Code', colX.code, y)
    doc.text('Service Order', colX.contract, y)
    doc.text('Description', colX.desc, y)
    doc.text('Hours', colX.hours, y)
    doc.text('Days', colX.days, y)
    y += 16
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 6

    // Table rows
    doc.font('Sans').fontSize(8)
    for (const date of sortedDates) {
        const entries = dailyData[date]
        const dayHours = entries.filter(e => e.trackingType !== 'days').reduce((s, e) => s + e.hours, 0)
        const dayDays = entries.filter(e => e.trackingType === 'days').reduce((s, e) => s + e.hours, 0)

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]
            // Measure text heights to handle wrapping
            doc.font('Sans').fontSize(8)
            const codeHeight = doc.heightOfString(entry.code, { width: 55 })
            const contractHeight = doc.heightOfString(entry.contractCode || ' ', { width: 95 })
            const descHeight = doc.heightOfString(entry.description || ' ', { width: 145 })
            const rowHeight = Math.max(14, codeHeight, contractHeight, descHeight) + 4

            if (y + rowHeight > 760) { doc.addPage(); y = 40 }
            if (i === 0) doc.font('Sans-Bold').text(format(parseISO(date), 'dd.MM.yyyy'), colX.date, y)
            doc.font('Sans')
            doc.text(entry.code, colX.code, y, { width: 55 })
            doc.text(entry.contractCode, colX.contract, y, { width: 95 })
            doc.text(entry.description, colX.desc, y, { width: 145 })
            if (entry.trackingType === 'days') {
                doc.text('-', colX.hours, y)
                doc.text(String(entry.hours), colX.days, y)
            } else {
                doc.text(String(entry.hours), colX.hours, y)
                doc.text('-', colX.days, y)
            }
            y += rowHeight
        }

        if (entries.length > 1) {
            if (y > 760) { doc.addPage(); y = 40 }
            doc.font('Sans-Oblique').fillColor('#555555')
            doc.text('Day total', colX.desc, y)
            doc.text(dayHours > 0 ? String(dayHours) : '-', colX.hours, y)
            doc.text(dayDays > 0 ? String(dayDays) : '-', colX.days, y)
            doc.font('Sans').fillColor('#000000')
            y += 14
        }

        doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#eeeeee')
        y += 4
    }

    // Per-project-code summary
    y += 10
    if (y > 680) { doc.addPage(); y = 40 }
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 8
    doc.font('Sans-Bold').fontSize(9).fillColor('#000000')
    doc.text('Summary by Project Code', 40, y)
    y += 16

    // Header row
    const sumColX = { code: 40, desc: 140, hours: 320, days: 390 }
    doc.font('Sans-Bold').fontSize(8).fillColor('#000000')
    doc.text('Code', sumColX.code, y)
    doc.text('Description', sumColX.desc, y)
    doc.text('Hours', sumColX.hours, y)
    doc.text('Days', sumColX.days, y)
    y += 14
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 4

    // Aggregate by subProjectCode
    const codeMap = new Map<string, { desc: string; hours: number; days: number }>()
    for (const row of rows) {
        const existing = codeMap.get(row.subProjectCode)
        const h = row.trackingType !== 'days' ? row.totalHours : 0
        const d = row.trackingType === 'days' ? row.totalHours : 0
        if (existing) {
            existing.hours += h
            existing.days += d
        } else {
            codeMap.set(row.subProjectCode, {
                desc: row.subProjectDescription || row.projectName,
                hours: h,
                days: d,
            })
        }
    }

    doc.font('Sans').fontSize(8)
    for (const [code, data] of codeMap) {
        if (y + 14 > 760) { doc.addPage(); y = 40 }
        doc.text(code, sumColX.code, y, { width: 95 })
        doc.text(data.desc, sumColX.desc, y, { width: 175 })
        doc.text(data.hours > 0 ? String(data.hours) : '—', sumColX.hours, y)
        doc.text(data.days > 0 ? String(data.days) : '—', sumColX.days, y)
        y += 14
    }

    // Grand total footer
    y += 10
    if (y > 730) { doc.addPage(); y = 40 }
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 8
    doc.font('Sans-Bold').fontSize(10)
    doc.text(`Total Hours: ${totalHours}`, 40, y)
    doc.text(`Total Days: ${totalDays}`, 200, y)
    y += 24
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 8
    doc.fontSize(8).font('Sans').fillColor('#666666')
    doc.text(`Generated: ${format(new Date(), 'dd.MM.yyyy')}`, 40, y)

    doc.end()

    const pdfBuffer = await new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)))
    })

    // Upload to Supabase Storage
    const storagePath = `exports/${user.id}/${month}.pdf`

    const { error: uploadError } = await adminClient
        .storage
        .from('timesheet-exports')
        .upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
        })

    if (uploadError) {
        return { error: `Upload failed: ${uploadError.message}` }
    }

    // Upsert pdf_exports record
    await adminClient
        .from('pdf_exports')
        .upsert({
            user_id: user.id,
            month: month,
            storage_path: storagePath,
        } as any, { onConflict: 'user_id, month' })

    // Generate signed URL
    const { data: signedUrlData, error: signedUrlError } = await adminClient
        .storage
        .from('timesheet-exports')
        .createSignedUrl(storagePath, 60 * 60) // 1 hour

    if (signedUrlError || !signedUrlData) {
        return { error: 'Failed to generate download URL' }
    }

    return { success: true, url: signedUrlData.signedUrl }
}

export async function getExportDownloadUrl(exportId: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    const adminClient = getSupabaseAdmin()

    const { data: exportRecord, error } = await adminClient
        .from('pdf_exports')
        .select('*')
        .eq('id', exportId)
        .single()

    if (error || !exportRecord) return { error: 'Export not found' }

    // Only allow user to access their own exports, or admins
    if (exportRecord.user_id !== user.id) {
        const { data: isAdmin } = await supabase.rpc('is_admin')
        if (!isAdmin) return { error: 'Unauthorized' }
    }

    const { data: signedUrlData, error: signedUrlError } = await adminClient
        .storage
        .from('timesheet-exports')
        .createSignedUrl(exportRecord.storage_path, 60 * 60)

    if (signedUrlError || !signedUrlData) return { error: 'Failed to generate URL' }

    return { url: signedUrlData.signedUrl }
}

export async function listPdfExports(filters?: { userId?: string }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    // Check admin
    const { data: isAdmin } = await supabase.rpc('is_admin')
    if (!isAdmin) return []

    const adminClient = getSupabaseAdmin()
    let query = adminClient
        .from('pdf_exports')
        .select('*')
        .order('created_at', { ascending: false })

    if (filters?.userId) {
        query = query.eq('user_id', filters.userId)
    }

    const { data: exports } = await query
    if (!exports?.length) return []

    // Fetch profiles separately (no FK from pdf_exports to profiles)
    const userIds = [...new Set(exports.map((e: any) => e.user_id))]
    const { data: profileRows } = await adminClient
        .from('profiles')
        .select('id, full_name, employee_id')
        .in('id', userIds)
    const profileMap = new Map(
        (profileRows || []).map((p: any) => [p.id, p])
    )

    return exports.map((e: any) => ({
        ...e,
        profiles: profileMap.get(e.user_id) || null,
    }))
}

const EXPENSE_TYPE_LABELS: Record<string, string> = {
    plane_ticket: 'E_011 Plane ticket', taxi: 'E_012 Taxi', bus: 'E_013 Bus',
    train: 'E_014 Train', mileage: 'E_015 Mileage', lodging: 'E_20 Lodging, Hotel',
    meals: 'E_30 Meals', other: 'N/A',
}

export async function generateExpensePdf(tableId: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No session' }

    // Fetch profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
    if (!profile) return { error: 'Profile not found' }

    // Check if admin (admins can export any table)
    const { data: isAdmin } = await supabase.rpc('is_admin')

    // Fetch expense table with project name
    const adminClient = getSupabaseAdmin()
    const { data: table, error: tableError } = await adminClient
        .from('expense_tables')
        .select('*, projects ( name )')
        .eq('id', tableId)
        .single()

    if (tableError || !table) return { error: 'Expense table not found' }

    // Verify ownership (unless admin)
    if ((table as any).user_id !== user.id && !isAdmin) {
        return { error: 'Unauthorized' }
    }

    // For admin exports, fetch the table owner's profile
    let ownerProfile = profile
    if ((table as any).user_id !== user.id) {
        const { data: op } = await adminClient
            .from('profiles')
            .select('*')
            .eq('id', (table as any).user_id)
            .single()
        if (op) ownerProfile = op as any
    }

    // Fetch entries
    const { data: entries, error: entriesError } = await adminClient
        .from('expense_entries')
        .select('*')
        .eq('expense_table_id', tableId)
        .order('expense_date', { ascending: true })

    if (entriesError) return { error: 'Failed to fetch entries' }
    const typedEntries = (entries || []) as unknown as ExpenseEntry[]

    if (typedEntries.length === 0) return { error: 'No entries in this expense table' }

    // Calculate total in PLN
    let totalPln = 0
    for (const entry of typedEntries) {
        totalPln += Number(entry.amount_pln ?? entry.amount)
    }

    const PDFDocument = (await import('pdfkit')).default
    const pageWidth = 595.28
    const rightMargin = 40
    const colX = { date: 40, location: 115, type: 210, desc: 300, amount: 470 }

    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    registerFonts(doc)
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))

    // Header
    doc.fontSize(16).font('Sans-Bold').text('Seaclouds - Expense Report', 40, 40)

    // Info block
    doc.moveDown(0.8)
    let y = doc.y
    doc.fontSize(9).fillColor('#000000').font('Sans')
    doc.text(`Name: ${ownerProfile.full_name || 'N/A'}`, 40, y)
    doc.text(`Employee ID: ${ownerProfile.employee_id || 'N/A'}`, 300, y)
    y += 14
    doc.text(`Position: ${ownerProfile.position || 'N/A'}`, 40, y)
    doc.text(`Project: ${(table as any).projects?.name ?? 'Unknown'}`, 300, y)
    y += 14
    if ((table as any).work_order) {
        doc.text(`Work Order: ${(table as any).work_order}`, 40, y)
        y += 14
    }
    if ((table as any).purpose) {
        doc.text(`Purpose: ${(table as any).purpose}`, 40, y)
        y += 14
    }
    doc.text(`Date Range: ${(table as any).start_date}${(table as any).end_date ? ' — ' + (table as any).end_date : ''}`, 40, y)
    const statusLabel = ((table as any).status ?? 'draft').charAt(0).toUpperCase() + ((table as any).status ?? 'draft').slice(1)
    doc.text(`Status: ${statusLabel}`, 300, y)
    y += 20

    // Table header
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 6
    doc.font('Sans-Bold').fontSize(7).fillColor('#000000')
    doc.text('Date', colX.date, y)
    doc.text('Location', colX.location, y)
    doc.text('Type', colX.type, y)
    doc.text('Description', colX.desc, y)
    doc.text('Amount (PLN)', colX.amount, y)
    y += 14
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 6

    // Table rows
    doc.font('Sans').fontSize(7)
    for (const entry of typedEntries) {
        const isPersonalCar = entry.expense_type === 'mileage'
        const typeLabel = EXPENSE_TYPE_LABELS[entry.expense_type] ?? entry.expense_type
        const descText = isPersonalCar && entry.km != null && entry.km_rate != null
            ? `${entry.km} km × ${entry.km_rate}/km`
            : entry.description || '—'
        const dateStr = entry.expense_date_end
            ? `${entry.expense_date} — ${entry.expense_date_end}`
            : entry.expense_date

        // Measure heights
        const descHeight = doc.heightOfString(descText, { width: 155 })
        const rowHeight = Math.max(12, descHeight) + 4

        if (y + rowHeight > 760) { doc.addPage(); y = 40 }

        doc.text(dateStr, colX.date, y, { width: 70 })
        doc.text(entry.location || '—', colX.location, y, { width: 90 })
        doc.text(typeLabel, colX.type, y, { width: 85 })
        doc.text(descText, colX.desc, y, { width: 155 })
        const plnAmount = Number(entry.amount_pln ?? entry.amount)
        doc.text(`${plnAmount.toFixed(2)}`, colX.amount, y, { width: 80 })

        y += rowHeight
        doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#eeeeee')
        y += 4
    }

    // Summary footer
    y += 10
    if (y > 720) { doc.addPage(); y = 40 }
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 8
    doc.font('Sans-Bold').fontSize(9)
    doc.text(`Total (PLN): ${totalPln.toFixed(2)}`, 40, y)
    y += 20

    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 8
    doc.fontSize(7).font('Sans').fillColor('#666666')
    doc.text(`Generated: ${format(new Date(), 'dd.MM.yyyy')}`, 40, y)

    doc.end()

    const pdfBuffer = await new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)))
    })

    // Upload to Supabase Storage (reuse timesheet-exports bucket)
    const storagePath = `exports/${(table as any).user_id}/expense-${tableId}.pdf`

    const { error: uploadError } = await adminClient
        .storage
        .from('timesheet-exports')
        .upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
        })

    if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

    // Generate signed URL
    const { data: signedUrlData, error: signedUrlError } = await adminClient
        .storage
        .from('timesheet-exports')
        .createSignedUrl(storagePath, 60 * 60)

    if (signedUrlError || !signedUrlData) return { error: 'Failed to generate download URL' }

    return { success: true, url: signedUrlData.signedUrl }
}
