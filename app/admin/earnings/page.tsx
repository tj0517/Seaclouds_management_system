import { format } from 'date-fns'
import { TrendingUp } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import { getMonthlyEarnings, getStatusesForMonth } from '@/app/data/actions/earnings'
import AdminEarningsClient from './AdminEarningsClient'

export default async function AdminEarningsPage({
    searchParams,
}: {
    searchParams: Promise<{ month?: string }>
}) {
    const params = await searchParams
    const month = params.month ?? format(new Date(), 'yyyy-MM')

    const supabase = await createClient()
    const [rows, statuses, projectsResult] = await Promise.all([
        getMonthlyEarnings(month),
        getStatusesForMonth(month),
        supabase.from('projects').select('id, name').eq('is_active', true).order('name'),
    ])

    const projects = (projectsResult.data ?? []) as { id: string; name: string }[]

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <TrendingUp className="h-8 w-8 text-primary" /> Earnings
                </h2>
                <p className="text-muted-foreground mt-1">
                    Monthly earnings computed from logged hours and approved expenses.
                </p>
            </div>
            <AdminEarningsClient month={month} rows={rows} statuses={statuses} projects={projects} />
        </div>
    )
}
