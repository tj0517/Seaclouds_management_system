import { getAdminExpenseTables } from '@/app/data/actions/expenses'
import { getUserRoleAndProjects } from '@/app/data/actions/auth-helpers'
import { Receipt } from 'lucide-react'
import AdminExpensesTable from './AdminExpensesTable'

export default async function AdminExpensesPage() {
    const roleInfo = await getUserRoleAndProjects()
    const allTables = await getAdminExpenseTables()

    // Scope to PM's projects if applicable
    const tables = roleInfo?.pmProjectIds
        ? allTables.filter(t => roleInfo.pmProjectIds!.includes(t.project_id))
        : allTables

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <Receipt className="h-8 w-8 text-primary" /> Expenses
                </h2>
                <p className="text-muted-foreground mt-1">Review and manage employee expense submissions.</p>
            </div>
            <AdminExpensesTable tables={tables} />
        </div>
    )
}
