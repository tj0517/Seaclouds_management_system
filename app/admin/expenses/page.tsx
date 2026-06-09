import { getAdminExpenseTables } from '@/app/data/actions/expenses'
import { Receipt } from 'lucide-react'
import AdminExpensesTable from './AdminExpensesTable'

export default async function AdminExpensesPage() {
    const tables = await getAdminExpenseTables()

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
