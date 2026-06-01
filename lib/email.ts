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
