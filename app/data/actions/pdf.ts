'use server'

import { createClient } from '@/utils/supabase/server'
import { getSupabaseAdmin } from '@/utils/supabase/admin'
import { format, startOfMonth, endOfMonth, parseISO, eachDayOfInterval, startOfWeek } from 'date-fns'
import { getGroupedReportData, type GroupedReportRow } from './timesheet'

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

    // Fetch timesheet data for this user
    const rows = await getGroupedReportData(startDate, endDate, { userId: user.id })

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
    type DayEntry = { code: string; description: string; hours: number; earnings: number; trackingType: string; contractCode: string }
    const dailyData: Record<string, DayEntry[]> = {}

    for (const row of rows) {
        for (const [date, hours] of Object.entries(row.dailyBreakdown)) {
            if (hours <= 0) continue
            if (!dailyData[date]) dailyData[date] = []
            const rate = row.trackingType === 'days' ? row.rateDaily : row.rateHourly
            // Get contract code for this project + week
            const ws = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
            const cc = contractCodeMap[row.projectName]?.[ws] || ''
            dailyData[date].push({
                code: row.subProjectCode,
                description: row.subProjectDescription || row.projectName,
                hours,
                earnings: rate ? hours * rate : 0,
                trackingType: row.trackingType,
                contractCode: cc,
            })
        }
    }

    // Calculate totals
    const totalHours = rows.filter(r => r.trackingType !== 'days').reduce((s, r) => s + r.totalHours, 0)
    const totalDays = rows.filter(r => r.trackingType === 'days').reduce((s, r) => s + r.totalHours, 0)
    const totalEarnings = rows.reduce((s, r) => s + r.earnings, 0)
    const workedDaysCount = Object.keys(dailyData).length

    const PDFDocument = (await import('pdfkit')).default
    const monthLabel = format(monthDate, 'MMMM yyyy')
    const sortedDates = Object.keys(dailyData).sort()
    const fmtPLN = (v: number) => v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    // Table column positions
    const colX = { date: 40, code: 110, contract: 170, desc: 270, hours: 420, earn: 475 }
    const pageWidth = 595.28 // A4
    const rightMargin = 40

    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))

    // Header
    doc.fontSize(16).font('Helvetica-Bold').text('Seaclouds - Monthly Timesheet Report', 40, 40)
    doc.fontSize(12).font('Helvetica').fillColor('#444444').text(`Month: ${monthLabel}`, 40, 62)

    // Employee info
    doc.moveDown(0.5)
    const infoY = doc.y
    doc.fontSize(10).fillColor('#000000').font('Helvetica')
    doc.text(`Name: ${profile.full_name || 'N/A'}`, 40, infoY)
    doc.text(`Employee ID: ${profile.employee_id || 'N/A'}`, 300, infoY)
    doc.text(`Position: ${profile.position || 'N/A'}`, 40, infoY + 16)

    // Table header
    let y = infoY + 44
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 6
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000')
    doc.text('Date', colX.date, y)
    doc.text('Code', colX.code, y)
    doc.text('Kod umowy', colX.contract, y)
    doc.text('Description', colX.desc, y)
    doc.text('Hours', colX.hours, y)
    doc.text('Earn (PLN)', colX.earn, y)
    y += 16
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 6

    // Table rows
    doc.font('Helvetica').fontSize(8)
    for (const date of sortedDates) {
        const entries = dailyData[date]
        const dayHours = entries.filter(e => e.trackingType !== 'days').reduce((s, e) => s + e.hours, 0)
        const dayDays = entries.filter(e => e.trackingType === 'days').reduce((s, e) => s + e.hours, 0)
        const dayEarnings = entries.reduce((s, e) => s + e.earnings, 0)

        for (let i = 0; i < entries.length; i++) {
            if (y > 760) { doc.addPage(); y = 40 }
            const entry = entries[i]
            if (i === 0) doc.font('Helvetica-Bold').text(format(parseISO(date), 'dd.MM.yyyy'), colX.date, y)
            doc.font('Helvetica')
            doc.text(entry.code, colX.code, y, { width: 55 })
            doc.text(entry.contractCode, colX.contract, y, { width: 95 })
            doc.text(entry.description, colX.desc, y, { width: 145 })
            doc.text(entry.trackingType === 'days' ? `${entry.hours}d` : `${entry.hours}h`, colX.hours, y)
            doc.text(entry.earnings > 0 ? fmtPLN(entry.earnings) : '-', colX.earn, y)
            y += 14
        }

        if (entries.length > 1) {
            if (y > 760) { doc.addPage(); y = 40 }
            doc.font('Helvetica-Oblique').fillColor('#555555')
            doc.text('Day total', colX.desc, y)
            const dayTotalParts: string[] = []
            if (dayHours > 0) dayTotalParts.push(`${dayHours}h`)
            if (dayDays > 0) dayTotalParts.push(`${dayDays}d`)
            doc.text(dayTotalParts.join(' + ') || '-', colX.hours, y)
            doc.text(dayEarnings > 0 ? fmtPLN(dayEarnings) : '-', colX.earn, y)
            doc.font('Helvetica').fillColor('#000000')
            y += 14
        }

        doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#eeeeee')
        y += 4
    }

    // Summary footer
    y += 10
    if (y > 730) { doc.addPage(); y = 40 }
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 8
    doc.font('Helvetica-Bold').fontSize(10)
    doc.text(`Total Hours: ${totalHours}h`, 40, y)
    doc.text(`Total Days: ${totalDays}d`, 200, y)
    doc.text(`Worked Days: ${workedDaysCount}`, 340, y)
    y += 18
    doc.fontSize(12).text(`Total Earnings: ${fmtPLN(totalEarnings)} PLN`, 40, y)
    y += 24
    doc.moveTo(40, y).lineTo(pageWidth - rightMargin, y).stroke('#cccccc')
    y += 8
    doc.fontSize(8).font('Helvetica').fillColor('#666666')
    doc.text(`Generated: ${format(new Date(), 'dd.MM.yyyy')}`, 40, y)

    doc.end()

    const pdfBuffer = await new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)))
    })

    // Upload to Supabase Storage
    const storagePath = `exports/${user.id}/${month}.pdf`
    const adminClient = getSupabaseAdmin()

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
        .select('*, profiles:user_id ( full_name, employee_id )')
        .order('created_at', { ascending: false })

    if (filters?.userId) {
        query = query.eq('user_id', filters.userId)
    }

    const { data } = await query
    return data || []
}
