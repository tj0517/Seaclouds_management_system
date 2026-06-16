'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye } from 'lucide-react'
import type { MonthlyEarningRow, EarningStatus } from '@/app/data/actions/earnings'
import StatusSelect from './StatusSelect'

function fmt(amount: number) {
    return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: 'PLN',
        minimumFractionDigits: 2,
    }).format(amount)
}

interface Props {
    month: string
    rows: MonthlyEarningRow[]
    statuses: Record<string, EarningStatus>
    projects: { id: string; name: string }[]
}

export default function AdminEarningsClient({ month, rows, statuses, projects }: Props) {
    const router = useRouter()

    const [filterEmployee, setFilterEmployee] = useState('')
    const [filterProject, setFilterProject] = useState('')
    const [filterStatus, setFilterStatus] = useState('')

    const filtered = useMemo(() => {
        return rows.filter(r => {
            if (filterEmployee && r.user_id !== filterEmployee) return false
            if (filterProject && !r.project_ids.includes(filterProject)) return false
            if (filterStatus) {
                const rowStatus = statuses[r.user_id] ?? 'pending'
                if (rowStatus !== filterStatus) return false
            }
            return true
        })
    }, [rows, statuses, filterEmployee, filterProject, filterStatus])

    const totals = filtered.reduce(
        (acc, r) => ({
            hours: acc.hours + r.total_hours,
            days: acc.days + r.total_days,
            earnings_hours: acc.earnings_hours + r.earnings_from_hours,
            earnings_days: acc.earnings_days + r.earnings_from_days,
            earnings: acc.earnings + r.earnings_pln,
            expenses: acc.expenses + r.total_approved_expenses_pln,
            sum: acc.sum + r.sum_pln,
        }),
        { hours: 0, days: 0, earnings_hours: 0, earnings_days: 0, earnings: 0, expenses: 0, sum: 0 }
    )

    const selectClass = 'border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-white'

    return (
        <div className="space-y-4">
            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">Month</label>
                    <input
                        type="month"
                        value={month}
                        onChange={e => router.push(`/admin/earnings?month=${e.target.value}`)}
                        className={selectClass}
                    />
                </div>

                <select
                    value={filterEmployee}
                    onChange={e => setFilterEmployee(e.target.value)}
                    className={selectClass}
                >
                    <option value="">All employees</option>
                    {rows.map(r => (
                        <option key={r.user_id} value={r.user_id}>{r.user_name}</option>
                    ))}
                </select>

                <select
                    value={filterProject}
                    onChange={e => setFilterProject(e.target.value)}
                    className={selectClass}
                >
                    <option value="">All projects</option>
                    {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>

                <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className={selectClass}
                >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="submitted">Submitted</option>
                    <option value="paid">Paid</option>
                    <option value="declined">Declined</option>
                </select>

                {(filterEmployee || filterProject || filterStatus) && (
                    <button
                        onClick={() => { setFilterEmployee(''); setFilterProject(''); setFilterStatus('') }}
                        className="text-xs text-gray-500 hover:text-gray-900 underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
                {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-6 py-10 text-center">
                        No results for the selected filters.
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                                <th className="px-4 py-2" />
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200">Hours</th>
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200 text-purple-500">Days</th>
                                <th colSpan={3} className="px-4 py-2 text-center border-l border-gray-200">Summary</th>
                                <th className="px-4 py-2" />
                                <th className="px-4 py-2" />
                            </tr>
                            <tr>
                                <th className="text-left px-4 py-3 font-medium">Employee</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200">Worked</th>
                                <th className="text-right px-4 py-3 font-medium">Rate</th>
                                <th className="text-right px-4 py-3 font-medium">Earnings</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200 text-purple-600">Worked</th>
                                <th className="text-right px-4 py-3 font-medium text-purple-600">Rate</th>
                                <th className="text-right px-4 py-3 font-medium text-purple-600">Earnings</th>
                                <th className="text-right px-4 py-3 font-medium border-l border-gray-200">Total Earnings</th>
                                <th className="text-right px-4 py-3 font-medium">Expenses</th>
                                <th className="text-right px-4 py-3 font-medium">Sum</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(r => (
                                <tr key={r.user_id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium whitespace-nowrap">{r.user_name}</td>
                                    {/* Hours */}
                                    <td className="px-4 py-3 text-right font-mono border-l border-gray-200">
                                        {r.total_hours > 0 ? `${r.total_hours} h` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-500 text-xs">
                                        {r.rate_hourly != null ? `${r.rate_hourly} PLN` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono">
                                        {r.earnings_from_hours > 0 ? fmt(r.earnings_from_hours) : <span className="text-gray-300">—</span>}
                                    </td>
                                    {/* Days */}
                                    <td className="px-4 py-3 text-right font-mono text-purple-700 border-l border-gray-200">
                                        {r.total_days > 0 ? `${r.total_days} d` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right text-purple-500 text-xs">
                                        {r.rate_daily != null ? `${r.rate_daily} PLN` : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-purple-700">
                                        {r.earnings_from_days > 0 ? fmt(r.earnings_from_days) : <span className="text-gray-300">—</span>}
                                    </td>
                                    {/* Summary */}
                                    <td className="px-4 py-3 text-right font-mono border-l border-gray-200">{fmt(r.earnings_pln)}</td>
                                    <td className="px-4 py-3 text-right font-mono">{fmt(r.total_approved_expenses_pln)}</td>
                                    <td className="px-4 py-3 text-right font-mono font-semibold text-blue-600">{fmt(r.sum_pln)}</td>
                                    {/* Status */}
                                    <td className="px-4 py-3">
                                        <StatusSelect
                                            userId={r.user_id}
                                            yearMonth={month}
                                            status={statuses[r.user_id] ?? 'pending'}
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <Link
                                            href={`/admin/earnings/${r.user_id}?month=${month}`}
                                            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 whitespace-nowrap"
                                        >
                                            <Eye className="h-4 w-4" /> View
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                                <td className="px-4 py-3">Total ({filtered.length})</td>
                                <td className="px-4 py-3 text-right font-mono border-l border-gray-200">
                                    {totals.hours > 0 ? `${totals.hours} h` : '—'}
                                </td>
                                <td />
                                <td className="px-4 py-3 text-right font-mono">{fmt(totals.earnings_hours)}</td>
                                <td className="px-4 py-3 text-right font-mono text-purple-700 border-l border-gray-200">
                                    {totals.days > 0 ? `${totals.days} d` : '—'}
                                </td>
                                <td />
                                <td className="px-4 py-3 text-right font-mono text-purple-700">{fmt(totals.earnings_days)}</td>
                                <td className="px-4 py-3 text-right font-mono border-l border-gray-200">{fmt(totals.earnings)}</td>
                                <td className="px-4 py-3 text-right font-mono">{fmt(totals.expenses)}</td>
                                <td className="px-4 py-3 text-right font-mono text-blue-600">{fmt(totals.sum)}</td>
                                <td colSpan={2} />
                            </tr>
                            <tr>
                                <td colSpan={12} className="px-4 py-3 text-xs text-gray-400">
                                    Sum = Total Earnings + Approved Expenses. Project filter shows employees with submitted hours on that project.
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>
        </div>
    )
}
