import { redirect } from 'next/navigation'
import { getUserProfile, getMyProjects, getExpenseTables, getExpenseEntries, getMyModulePermissions } from '@/app/data/actions'
import type { ExpenseTableWithProject, ExpenseEntry } from '@/app/data/actions/expenses'
import ExpensesGrid from './ExpensesGrid'
import Link from 'next/link'
import { ChevronLeft, Shield } from 'lucide-react'
import AccountMenu from '../components/AccountMenu'
import ModuleSwitcher from '../components/ModuleSwitcher'

export default async function ExpensesPage() {
    const result = await getUserProfile()
    if (!result || !result.user) redirect('/login')

    const { user, profile } = result
    const isAdmin = profile?.role === 'admin'

    const projects = await getMyProjects()
    const tables = await getExpenseTables()
    const myModules = await getMyModulePermissions()

    // Fetch entries for each table
    const tablesWithEntries = await Promise.all(
        tables.map(async (table) => {
            const entries = await getExpenseEntries(table.id)
            return { ...table, entries }
        })
    )

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white shadow-sm sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/"
                            className="p-2 hover:bg-gray-100 rounded-md transition text-gray-600"
                            title="Back to timesheet"
                        >
                            <ChevronLeft size={20} />
                        </Link>
                        <h1 className="text-xl font-bold text-gray-900">My Expenses</h1>
                    </div>

                    <div className="flex items-center gap-4">
                        {isAdmin && (
                            <Link href="/admin" className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-3 py-2 rounded-lg">
                                <Shield size={16} /> <span className="hidden sm:inline">Admin Panel</span>
                            </Link>
                        )}
                        <ModuleSwitcher hasDcsAccess={myModules.includes('dcs')} />
                        <AccountMenu email={user.email || ''} />
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
                <ExpensesGrid
                    projects={projects}
                    tables={tablesWithEntries}
                />
            </main>
        </div>
    )
}
