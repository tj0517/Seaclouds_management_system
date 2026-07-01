import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendAdminNotification({
    employeeName,
    subProjectCode,
    weekStart,
}: {
    employeeName: string
    subProjectCode: string
    weekStart: string
}) {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
    console.log('[EMAIL] sendAdminNotification called', { adminEmail, employeeName, subProjectCode, weekStart })
    console.log('[EMAIL] RESEND_API_KEY present:', !!process.env.RESEND_API_KEY)
    if (!adminEmail) {
        console.log('[EMAIL] ADMIN_NOTIFICATION_EMAIL not set, skipping')
        return
    }

    try {
        const result = await resend.emails.send({
            from: 'Seaclouds Timesheets <notification@seaclouds.eu>',
            to: [adminEmail],
            subject: `Timesheet submitted — ${employeeName}, week ${weekStart}`,
            html: `
                <p><strong>${employeeName}</strong> submitted their timesheet for sub-project <strong>${subProjectCode}</strong>, week starting <strong>${weekStart}</strong>.</p>
                <p>Please log in to review and approve.</p>
            `,
        })
        console.log('[EMAIL] sendAdminNotification result:', JSON.stringify(result))
    } catch (err) {
        console.error('[EMAIL] sendAdminNotification FAILED:', err)
    }
}

export async function sendExpenseSubmittedNotification({
    employeeName,
    projectName,
    dateRange,
}: {
    employeeName: string
    projectName: string
    dateRange: string
}) {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
    console.log('[EMAIL] sendExpenseSubmittedNotification called', { adminEmail, employeeName, projectName, dateRange })
    if (!adminEmail) {
        console.log('[EMAIL] ADMIN_NOTIFICATION_EMAIL not set, skipping')
        return
    }

    try {
        const result = await resend.emails.send({
            from: 'Seaclouds Expenses <notification@seaclouds.eu>',
            to: [adminEmail],
            subject: `Expense submitted — ${employeeName}, ${projectName}`,
            html: `
                <p><strong>${employeeName}</strong> submitted an expense table for project <strong>${projectName}</strong>.</p>
                <p><strong>Date range:</strong> ${dateRange}</p>
                <p>Please log in to review and approve or decline.</p>
            `,
        })
        console.log('[EMAIL] sendExpenseSubmittedNotification result:', JSON.stringify(result))
    } catch (err) {
        console.error('[EMAIL] sendExpenseSubmittedNotification FAILED:', err)
    }
}

export async function sendExpenseApprovedNotification({
    employeeEmail,
    employeeName,
    projectName,
}: {
    employeeEmail: string
    employeeName: string
    projectName: string
}) {
    console.log('[EMAIL] sendExpenseApprovedNotification called', { employeeEmail, employeeName, projectName })
    try {
        const result = await resend.emails.send({
            from: 'Seaclouds Expenses <notification@seaclouds.eu>',
            to: [employeeEmail],
            subject: `Expense approved — ${projectName}`,
            html: `
                <p>Hi <strong>${employeeName}</strong>,</p>
                <p>Your expense table for project <strong>${projectName}</strong> has been <strong style="color: #16a34a;">approved</strong>.</p>
                <p>No further action is needed.</p>
            `,
        })
        console.log('[EMAIL] sendExpenseApprovedNotification result:', JSON.stringify(result))
    } catch (err) {
        console.error('[EMAIL] sendExpenseApprovedNotification FAILED:', err)
    }
}

export async function sendTimesheetWithdrawNotification({
    employeeEmail,
    employeeName,
    subProjectCode,
    weekStart,
    reason,
}: {
    employeeEmail: string
    employeeName: string
    subProjectCode: string
    weekStart: string
    reason: string
}) {
    console.log('[EMAIL] sendTimesheetWithdrawNotification called', { employeeEmail, employeeName, subProjectCode, weekStart })
    try {
        const result = await resend.emails.send({
            from: 'Seaclouds Timesheets <notification@seaclouds.eu>',
            to: [employeeEmail],
            subject: `Timesheet rejected — ${subProjectCode}, week ${weekStart}`,
            html: `
                <p>Hi <strong>${employeeName}</strong>,</p>
                <p>Your timesheet for sub-project <strong>${subProjectCode}</strong>, week starting <strong>${weekStart}</strong>, has been <strong style="color: #dc2626;">rejected</strong> by an admin.</p>
                ${reason ? `<p><strong>Reason:</strong></p><blockquote style="border-left: 3px solid #e5e7eb; padding-left: 12px; color: #4b5563;">${reason}</blockquote>` : ''}
                <p>Please log in to review and resubmit your timesheet.</p>
            `,
        })
        console.log('[EMAIL] sendTimesheetWithdrawNotification result:', JSON.stringify(result))
    } catch (err) {
        console.error('[EMAIL] sendTimesheetWithdrawNotification FAILED:', err)
    }
}

export async function sendExpenseDeclineNotification({
    employeeEmail,
    employeeName,
    projectName,
    reason,
}: {
    employeeEmail: string
    employeeName: string
    projectName: string
    reason: string
}) {
    console.log('[EMAIL] sendExpenseDeclineNotification called', { employeeEmail, employeeName, projectName })
    try {
        const result = await resend.emails.send({
            from: 'Seaclouds Expenses <notification@seaclouds.eu>',
            to: [employeeEmail],
            subject: `Expense table declined — ${projectName}`,
            html: `
                <p>Hi <strong>${employeeName}</strong>,</p>
                <p>Your expense table for project <strong>${projectName}</strong> has been declined.</p>
                <p><strong>Reason:</strong></p>
                <blockquote style="border-left: 3px solid #e5e7eb; padding-left: 12px; color: #4b5563;">${reason}</blockquote>
                <p>Please log in to review the feedback, withdraw the submission, and resubmit after making changes.</p>
            `,
        })
        console.log('[EMAIL] sendExpenseDeclineNotification result:', JSON.stringify(result))
    } catch (err) {
        console.error('[EMAIL] sendExpenseDeclineNotification FAILED:', err)
    }
}
