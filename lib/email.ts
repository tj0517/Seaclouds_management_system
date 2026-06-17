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
    if (!adminEmail) return

    await resend.emails.send({
        from: 'Seaclouds Timesheets <onboarding@resend.dev>',
        to: [adminEmail],
        subject: `Timesheet submitted — ${employeeName}, week ${weekStart}`,
        html: `
            <p><strong>${employeeName}</strong> submitted their timesheet for sub-project <strong>${subProjectCode}</strong>, week starting <strong>${weekStart}</strong>.</p>
            <p>Please log in to review and approve.</p>
        `,
    })
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
    await resend.emails.send({
        from: 'Seaclouds Expenses <onboarding@resend.dev>',
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
}
